import json
import sys

for line in sys.stdin:
    d = json.loads(line)
    if "network" in d:
        print(d)
        continue
    print(f"{d['rule']:22s} med {d['median']:5} p90 {d['p90']:5} p99 {d['p99']:5} mean {d['mean']:7.1f} "
          f">200 {d['over200']:5.1f}% >500 {d['over500']:5.1f}% >1000 {d['over1000']:5.2f}% "
          f"(n>500={d.get('over500Count')}, max {d.get('max')}) cap {d['capExceeded']:.2f}% end {d['endgameMedian']}/{d['endgameP90']} "
          f"lottery_events {d['lotteriesPerGame']:.0f} onY {d['targetTurnShare']:.1f}%")
