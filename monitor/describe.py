"""Full posting bodies, for resume matching (match.py).

Most listings carry only a title, so the body is fetched per posting - and
only for the handful of NEW postings in a run, never the whole board. A
fetcher fills `description` when its listing already includes the body
(Lever, Ashby, Amazon, Naukri...), or `detail_url` when the body sits behind
one cheap per-posting call (Workday's CXS endpoint, LinkedIn's logged-out
job view...). Anything else falls back to the posting page itself, which
works for server-rendered careers sites and yields nothing for client-
rendered ones; match.py then scores on the title alone and says so.
"""
import concurrent.futures as cf
import html
import json
import re

from .fetchers.http import DESCRIPTION_LIMIT, full_text, get_text, session

# Shorter than this and the "body" is a cookie banner or an app shell.
MIN_BODY = 400

LI_MARKUP = re.compile(r'class="show-more-less-html__markup[^"]*"[^>]*>(.*?)</div>', re.S)
NOISE = re.compile(r"<(script|style|noscript|svg|head)\b.*?</\1>", re.S | re.I)


def _join(*parts) -> str:
    return full_text(" ".join(p for p in parts if isinstance(p, str) and p))


def _workday(text):
    info = json.loads(text).get("jobPostingInfo") or {}
    return _join(info.get("jobDescription", ""))


def _greenhouse(text):
    # content arrives entity-escaped HTML: unescape once to get the tags back
    return _join(html.unescape(json.loads(text).get("content", "") or ""))


def _smartrecruiters(text):
    sections = (json.loads(text).get("jobAd") or {}).get("sections") or {}
    return _join(*((sections.get(k) or {}).get("text", "") for k in
                   ("jobDescription", "qualifications", "additionalInformation")))


def _microsoft(text):
    r = (json.loads(text).get("operationResult") or {}).get("result") or {}
    return _join(r.get("description", ""), r.get("responsibilities", ""),
                 r.get("qualifications", ""))


def _linkedin(text):
    m = LI_MARKUP.search(text)
    return _join(m.group(1) if m else "")


def _page(text):
    return _join(NOISE.sub(" ", text))


PARSERS = (
    ("/wday/cxs/", _workday),
    ("boards-api.greenhouse.io", _greenhouse),
    ("api.smartrecruiters.com", _smartrecruiters),
    ("gcsservices.careers.microsoft.com", _microsoft),
    ("linkedin.com/jobs-guest/", _linkedin),
)


def parser_for(url: str):
    return next((fn for marker, fn in PARSERS if marker in url), _page)


def fetch(job: dict, s=None) -> str:
    """Best available body for one posting; '' when nothing usable came back."""
    if len(job.get("description") or "") >= MIN_BODY:
        return job["description"][:DESCRIPTION_LIMIT]
    s = s or session()
    for url in (job.get("detail_url"), job.get("url")):
        if not url:
            continue
        try:
            body = parser_for(url)(get_text(s, url, retries=1, timeout=20))
        except Exception:  # noqa: BLE001 - one dead link must not sink the run
            continue
        if len(body) >= MIN_BODY:
            return body
    return job.get("description") or ""


def fill(jobs: list, workers: int = 4) -> int:
    """Set `description` on every job that lacks one. Returns how many have one.

    A few threads, not one per job: LinkedIn rate-limits a burst from one IP,
    and a GitHub runner is one IP.
    """
    s = session()
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for job, body in zip(jobs, ex.map(lambda j: fetch(j, s), jobs)):
            job["description"] = body
    return sum(1 for j in jobs if len(j.get("description") or "") >= MIN_BODY)
