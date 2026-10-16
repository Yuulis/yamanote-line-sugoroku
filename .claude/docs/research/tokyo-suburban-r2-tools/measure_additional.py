"""Measure the intermediate target share after the 3/4 lever overshot the old duration."""

from __future__ import annotations

import argparse

from run_matrix import measure


def additional_cases() -> list[dict]:
    return [
        {
            "name": "target-two-thirds",
            "input": "official",
            "preset": "decided",
            "games": 5000,
            "targetShare": [2, 3],
        }
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args()
    if args.jobs < 1:
        parser.error("jobs must be positive")
    measure(additional_cases(), args.jobs)
