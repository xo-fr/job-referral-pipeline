import json
from datetime import date

import pytest

from monitor import describe, match

LONG = "Build Java and Spring Boot microservices on AWS. " * 20


# --- describe: per-source body parsers --------------------------------------

def test_parser_dispatch_by_detail_url():
    assert describe.parser_for("https://x.wd5.myworkdayjobs.com/wday/cxs/x/site/job/a") is describe._workday
    assert describe.parser_for("https://boards-api.greenhouse.io/v1/boards/t/jobs/1") is describe._greenhouse
    assert describe.parser_for("https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/9") is describe._linkedin
    assert describe.parser_for("https://careers.example.com/job/1") is describe._page


def test_workday_body():
    text = json.dumps({"jobPostingInfo": {"jobDescription": "<p>Java &amp; Kafka</p>"}})
    assert describe._workday(text) == "Java & Kafka"


def test_greenhouse_body_is_unescaped():
    text = json.dumps({"content": "&lt;p&gt;Spring Boot&lt;/p&gt;"})
    assert describe._greenhouse(text) == "Spring Boot"


def test_linkedin_body_from_markup():
    page = ('<section><div class="show-more-less-html__markup relative">'
            '<p>Senior Java role</p></div><div>footer</div></section>')
    assert describe._linkedin(page) == "Senior Java role"


def test_page_fallback_drops_scripts():
    page = "<html><head><title>t</title></head><script>var a=1</script><p>Body</p></html>"
    assert describe._page(page) == "Body"


def test_fetch_keeps_a_body_already_in_hand(monkeypatch):
    monkeypatch.setattr(describe, "get_text", lambda *a, **k: pytest.fail("no fetch"))
    assert describe.fetch({"description": LONG}) == LONG[: describe.DESCRIPTION_LIMIT]


def test_fetch_falls_back_from_detail_to_page(monkeypatch):
    calls = []

    def fake(s, url, **kw):
        calls.append(url)
        if "cxs" in url:
            raise RuntimeError("boom")
        return f"<p>{LONG}</p>"

    monkeypatch.setattr(describe, "get_text", fake)
    body = describe.fetch({"detail_url": "https://h/wday/cxs/t/s/job/1",
                           "url": "https://h/en-US/s/job/1"})
    assert calls == ["https://h/wday/cxs/t/s/job/1", "https://h/en-US/s/job/1"]
    assert body.startswith("Build Java")


def test_fetch_gives_up_quietly(monkeypatch):
    monkeypatch.setattr(describe, "get_text", lambda *a, **k: "<p>too short</p>")
    assert describe.fetch({"url": "https://h/job"}) == ""


# --- match: shaping the model's output --------------------------------------

def test_clean_clamps_and_recomputes_verdict():
    out = match.clean({"score": 140, "verdict": "poor", "reasons": ["a", "b", "c", "d"],
                       "gaps": [], "pitch": "x" * 500, "keywords": ["Java"] * 9},
                      "description")
    assert out["score"] == 100 and out["verdict"] == "strong"
    assert len(out["reasons"]) == 3 and len(out["keywords"]) == 5
    assert len(out["pitch"]) == 280


def test_clean_caps_title_only_matches():
    out = match.clean({"score": 92, "reasons": [], "gaps": [], "pitch": "", "keywords": []},
                      "title")
    assert out["score"] == 70 and out["verdict"] == "good" and out["basis"] == "title"


@pytest.mark.parametrize("score,verdict", [(85, "strong"), (84, "good"), (70, "good"),
                                           (69, "stretch"), (50, "stretch"), (49, "poor")])
def test_verdict_bands(score, verdict):
    assert match.verdict_for(score) == verdict


def test_prompt_basis():
    _, basis = match.prompt({"title": "SDE", "description": LONG}, "resume")
    assert basis == "description"
    text, basis = match.prompt({"title": "SDE", "snippet": "short"}, "resume")
    assert basis == "title" and "BASIS: title" in text


# --- match: what gets scored, and what gets written -------------------------

def _state(**jobs):
    return {"jobs": jobs}


def test_pending_skips_scored_old_and_exhausted():
    today = date.today().isoformat()
    st = _state(
        a={"first_seen": today, "posted_at": "2026-01-02"},
        b={"first_seen": today, "match": {"score": 1}},
        c={"first_seen": "2000-01-01"},
        d={"first_seen": today, "match_error": {"attempts": match.MAX_ATTEMPTS}},
        e={"first_seen": today, "posted_at": "2026-01-05"},
    )
    assert [j["id"] for j in match.pending(st, "2026-01-01")] == ["e", "a"]


def test_run_is_a_noop_without_secrets(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("RESUME_TEXT", "resume")
    assert match.run(_state())["skipped"] == "no GEMINI_API_KEY"


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("RESUME_TEXT", "Java engineer")
    monkeypatch.setenv("MATCH_INTERVAL", "0")
    monkeypatch.setattr(describe, "fill", lambda jobs, workers=4: len(jobs))


def _reply(score=88):
    return {"score": score, "verdict": "strong", "reasons": ["Java"], "gaps": [],
            "pitch": "I build Java services.", "keywords": ["Java"]}


def test_run_scores_new_then_backlog_within_limit(monkeypatch, armed):
    today = date.today().isoformat()
    st = _state(n={"first_seen": today, "title": "new"},
                o={"first_seen": today, "title": "old"},
                p={"first_seen": today, "title": "older"})
    seen = []
    monkeypatch.setattr(match, "call_gemini",
                        lambda text, *a, **k: seen.append(text) or _reply())
    new = [dict(st["jobs"]["n"], id="n", description=LONG)]
    stats = match.run(st, new, limit=2)
    assert stats["scored"] == 2
    assert "Title: new" in seen[0]
    assert st["jobs"]["n"]["match"]["score"] == 88
    assert st["jobs"]["n"]["match"]["model"] == match.DEFAULT_MODEL
    assert sum("match" in j for j in st["jobs"].values()) == 2


def test_run_stops_on_rate_limit_and_records_bad_replies(monkeypatch, armed):
    today = date.today().isoformat()
    st = _state(a={"first_seen": today, "posted_at": "2026-01-03"},
                b={"first_seen": today, "posted_at": "2026-01-02"},
                c={"first_seen": today, "posted_at": "2026-01-01"})
    replies = iter([ValueError("blocked"), _reply(), match.RateLimited("quota")])

    def fake(*a, **k):
        r = next(replies)
        if isinstance(r, Exception):
            raise r
        return r

    monkeypatch.setattr(match, "call_gemini", fake)
    stats = match.run(st, limit=10)
    assert stats == {"scored": 1, "failed": 1, "skipped": ""}
    assert st["jobs"]["a"]["match_error"]["attempts"] == 1
    assert "match" in st["jobs"]["b"]
    assert "match" not in st["jobs"]["c"] and "match_error" not in st["jobs"]["c"]


def test_dry_run_writes_nothing(monkeypatch, armed):
    st = _state(a={"first_seen": date.today().isoformat()})
    monkeypatch.setattr(match, "call_gemini", lambda *a, **k: _reply())
    match.run(st, dry_run=True)
    assert "match" not in st["jobs"]["a"]
