"""Cloud solves on Modal (https://modal.com), billed by the second, for when your Mac is away.

The app on your phone writes the job to your account (a 'solvejob-' row, as for the Mac) and then POSTs it here with
your session token and its sync cursor. This endpoint checks the token against the account server, checks the account
is allowed to spend (CLOUD_USERS), and starts one container that runs the Mac's own bridge in --once mode
(tools/local-solver/server.cjs): it solves the job with the same solvers, pushes progress and what it has cost every
10 seconds, pushes the answer and exits. A cancel from the phone stops it at the next progress check.

Deploy: .github/workflows/cloud-solver.yml (on every push to main that touches the solvers, or by hand). It needs
the repository secrets MODAL_TOKEN_ID and MODAL_TOKEN_SECRET (Modal → Settings → API tokens) and CLOUD_USERS (the
usernames or emails allowed to start cloud solves, comma separated). The endpoint's address is printed by the deploy
and goes into CLOUD_SOLVER.url in studio/spot-ui.js.

Price (Modal's list price, November 2026): 8 physical cores at $0.0000131 per core-second plus 8 GiB at $0.00000222
per GiB-second, so about $0.44 an hour. RATE must match it; the worker multiplies it by its own run time.

Big jobs (job.size == "big": preflop lines that can reach a three-way flop, hours on a Mac) get a 32-core container
(BIG_RATE, about $1.64 an hour) that solves 8 of their 3-way flops at once, so they finish in tens of minutes. Their
price per solve is about the same as on 8 cores; only the wait shrinks. studio/spot-ui.js CLOUD_SOLVER.big must match.
The preflop three-way equity table (about 2 minutes to build) is kept on a Modal Volume, so it's built once.
"""
import json
import os
import subprocess
import tempfile
import urllib.request

import modal

CORES = 8
MEMORY_MB = 8192
RATE = round(CORES * 0.0000131 * 3600 + MEMORY_MB / 1024 * 0.00000222 * 3600, 3)
BIG_CORES = 32
BIG_MEMORY_MB = 16384
BIG_RATE = round(BIG_CORES * 0.0000131 * 3600 + BIG_MEMORY_MB / 1024 * 0.00000222 * 3600, 3)
BIG_HOURS = 6
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
IGNORE = ["render-site", "**/*.png", "**/node_modules", "**/TexasSolver", "**/.cmake-venv", "**/plo_solver", "**/mw_solver", "**/equity3"]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("build-essential", "cmake", "git", "python3-dev", "python3-setuptools", "libgomp1", "curl", "ca-certificates")
    .run_commands("curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs")
    # setuptools gives TexasSolver's bundled pybind11 the distutils module Python 3.12 dropped.
    .pip_install("fastapi[standard]", "setuptools")
    .add_local_dir(os.path.join(ROOT, "studio"), "/app/studio", copy=True, ignore=IGNORE)
    .add_local_dir(os.path.join(ROOT, "tools"), "/app/tools", copy=True, ignore=IGNORE)
    .add_local_dir(os.path.join(ROOT, "river"), "/app/river", copy=True)
    # x86-64-v3 (AVX2) runs on every machine Modal schedules CPU work on; -march=native would tie the image to the builder.
    .run_commands("cd /app && CITRUS_MARCH=x86-64-v3 bash tools/local-solver/install-mac.sh")
)
app = modal.App("guava-solver", image=image)
secret = modal.Secret.from_name("guava-cloud")
cache = modal.Volume.from_name("guava-solver-cache", create_if_missing=True)
CACHE = "/cache"
ALLOWED_APIS = ("https://range-lab-live-rooms.onrender.com",)


@app.function(cpu=CORES, memory=MEMORY_MB, timeout=3600, secrets=[secret], volumes={CACHE: cache})
def solve(job: dict):
    """One job, start to finish, on this container's cores."""
    run_job(job, CORES, MEMORY_MB, RATE, 3300)


@app.function(cpu=BIG_CORES, memory=BIG_MEMORY_MB, timeout=BIG_HOURS * 3600, secrets=[secret], volumes={CACHE: cache})
def solve_big(job: dict):
    """A preflop line that reaches three-way flops: 8 flops at a time on 32 cores."""
    run_job(job, BIG_CORES, BIG_MEMORY_MB, BIG_RATE, BIG_HOURS * 3600 - 300)


def run_job(job: dict, cores: int, memory_mb: int, rate: float, timeout: int):
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "job.json")
        with open(path, "w") as f:
            json.dump(job, f)
        print("Cloud solve", job["id"], "for", job["link"]["user"], "on", cores, "cores")
        table = os.path.join(CACHE, "equity3.bin")
        had_table = os.path.exists(table)
        run = subprocess.run(
            ["node", "tools/local-solver/server.cjs", "--name", "modal", "--rate", str(rate), "--once", path,
             "--threads", str(cores * 2), "--parallel", str(max(1, cores // 4)), "--memory", str(int(memory_mb * 0.8)),
             "--timeout", str(timeout)],
            cwd="/app", env={**os.environ, "CITRUS_BRIDGE_LINK": os.path.join(tmp, "link.json"), "CITRUS_EQUITY3": table},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
        print(run.stdout[-4000:])
        if not had_table and os.path.exists(table):
            cache.commit()
        # The worker reports its own failures on the job. If it crashed before it could, say so here, so the phone
        # shows why instead of waiting.
        if run.returncode != 0:
            lines = [l for l in run.stdout.strip().splitlines() if l.strip()]
            fail(job, "The cloud worker stopped" + (": " + lines[-1][:200] if lines else "."))


def fail(job: dict, message: str):
    link, value = job["link"], {**job["job"], "status": "failed", "message": message, "worker": "modal"}
    row = {"store": "meta", "id": job["id"], "t": int(job.get("t") or 0) + 5000, "data": {"id": job["id"], "value": value}}
    req = urllib.request.Request(link["api"] + "/api/sync", data=json.dumps({"rows": [row]}).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer " + link["token"]})
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except Exception as e:
        print("Could not report the failure:", e)


def account_user(api: str, token: str):
    req = urllib.request.Request(api + "/api/auth/me", headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["user"]


@app.function(secrets=[secret], cpu=0.125, memory=256)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware

    api = FastAPI()
    api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization"])
    allowed = {u.strip().lower() for u in os.environ.get("CLOUD_USERS", "").split(",") if u.strip()}

    @api.get("/")
    def info():
        return {"ok": True, "rate": RATE, "threads": CORES * 2, "big": {"rate": BIG_RATE, "threads": BIG_CORES * 2}}

    @api.post("/solve")
    async def start(request: Request):
        body = await request.json()
        auth = request.headers.get("authorization", "")
        token = auth[7:] if auth.startswith("Bearer ") else ""
        origin = str(body.get("api", "")).rstrip("/")
        job_id, job = str(body.get("id", "")), body.get("job")
        if origin not in ALLOWED_APIS:
            raise HTTPException(400, "Cloud solves only run for the main Guava Poker server. Update the app and try again.")
        if not token:
            raise HTTPException(401, "Sign in again.")
        if not job_id.startswith("solvejob-") or not isinstance(job, dict):
            raise HTTPException(400, "This solve request was incomplete. Update the app and try again.")
        try:
            user = account_user(origin, token)
        except Exception:
            raise HTTPException(401, "Sign in again.")
        if not allowed & {str(user.get("username", "")).lower(), str(user.get("email") or "").lower()}:
            raise HTTPException(403, "This account can't start cloud solves.")
        if job.get("target") != "modal":
            raise HTTPException(400, "This job isn't for the cloud.")
        worker = solve_big if job.get("size") == "big" and job.get("kind") == "preflop" else solve
        await worker.spawn.aio({"id": job_id, "job": job, "t": int(body.get("t") or 0), "cursor": int(body.get("cursor") or 0),
                     "link": {"api": origin, "token": token, "user": user["id"]}})
        return {"started": True, "rate": BIG_RATE if worker is solve_big else RATE}

    return api
