"""Researcher's through-running option B (as operated) applied to a core network JSON."""
import json
import sys

src, dst = sys.argv[1], sys.argv[2]
net = json.load(open(src, encoding="utf-8"))
S = {s["id"]: s for s in net["services"]}


def oriented(sid: str, first: str) -> list[str]:
    stops = S[sid]["stops"]
    return stops if stops[0] == first else stops[::-1]


def chain(a: list[str], b: list[str]) -> list[str]:
    assert a[-1] == b[0], (a[-1], b[0])
    return a + b[1:]


tokaido_in = oriented("tokaido", "tokyo")[::-1]  # 湯河原 → 東京
keiyo = oriented("keiyo", "tokyo")
musashino = oriented("musashino", S["musashino"]["stops"][0])
if musashino[-1] != "nishi-funabashi":
    musashino = musashino[::-1]
shiohama = keiyo.index("ichikawa-shiohama")
new = {
    "ueno_tokyo_utsunomiya": chain(tokaido_in, oriented("utsunomiya", "tokyo")),
    "ueno_tokyo_takasaki": chain(tokaido_in, oriented("takasaki", "tokyo")),
    "yokosuka_sobu": chain(oriented("yokosuka", "tokyo")[::-1], oriented("sobu_rapid", "tokyo")),
    "musashino_tokyo": musashino + keiyo[: shiohama + 1][::-1],
    "musashino_kaihin": ["nishi-funabashi"] + oriented("musashino_futamata", "nishi-funabashi")[1:]
    + keiyo[keiyo.index("minami-funabashi") + 1 : keiyo.index("kaihin-makuhari") + 1],
}
drop = {"tokaido", "utsunomiya", "takasaki", "yokosuka", "sobu_rapid", "musashino",
        "musashino_takaya", "musashino_futamata"}
out = []
for s in net["services"]:
    if s["id"] == "tokaido":
        out += [{**S["utsunomiya"], "id": k, "stops": new[k]} for k in ("ueno_tokyo_utsunomiya", "ueno_tokyo_takasaki")]
    elif s["id"] == "yokosuka":
        out.append({**s, "id": "yokosuka_sobu", "stops": new["yokosuka_sobu"]})
    elif s["id"] == "musashino":
        out += [{**s, "id": k, "stops": new[k]} for k in ("musashino_tokyo", "musashino_kaihin")]
    elif s["id"] not in drop:
        out.append(s)
for s in out:
    assert len(set(s["stops"])) == len(s["stops"]), s["id"]
net = {**net, "label": net["label"] + "-optionB", "services": out}
json.dump(net, open(dst, "w", encoding="utf-8"), ensure_ascii=False)
print(len(out), "services;", {k: len(v) for k, v in new.items()})
