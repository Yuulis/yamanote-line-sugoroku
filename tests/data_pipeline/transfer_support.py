"""Synthetic stop with two disconnected platform features (reviewed transfer)."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from shapely.geometry import LineString, Point

from scripts.data_pipeline.constraints import PlatformTransfer
from scripts.data_pipeline.n02 import PlatformCandidate, TrackSection
from scripts.data_pipeline.overrides import LengthRef, LineRange, Overrides
from scripts.data_pipeline.registry import RegistryStation, ScopeStop
from tests.data_pipeline.composition_support import SyntheticSource, recipe
from tests.data_pipeline.support import candidate

TRANSFER_LINE = "LS"
TRANSFER_GAP_M = 60.0


class TransferSource(SyntheticSource):
    """Line LS: t -> x on one component, x' -> y on another, x/x' one station."""

    def __init__(
        self,
        departure: tuple[float, float] = (TRANSFER_GAP_M, 0.0),
        onward: tuple[float, float] = (0.0, 400.0),
        east: float = 0.0,
    ) -> None:
        """``x'`` lies ``departure`` metres from ``x``; ``y`` ``onward`` from ``x'``.

        ``east`` shifts x, x' and y together (rounding-boundary positions).
        """
        super().__init__()
        t = self.points["t"]
        x = Point(t.x + east, t.y + 400)
        moved = Point(x.x + departure[0], x.y + departure[1])
        self.points.update(
            {"x": x, "x'": moved, "y": Point(moved.x + onward[0], moved.y + onward[1])}
        )

    def platform_candidates(self, names: Any, lines: Any) -> list[PlatformCandidate]:
        wanted = set(lines)
        result = super().platform_candidates(names, wanted - {TRANSFER_LINE})
        if TRANSFER_LINE in wanted:
            for code, (station, point) in enumerate(
                (("t", "t"), ("x", "x"), ("x", "x'"), ("y", "y")), start=100
            ):
                if station in names:
                    x, y = self.points[point].coords[0]
                    result.append(
                        candidate(
                            station,
                            x,
                            y,
                            code=str(code),
                            line=TRANSFER_LINE,
                            group=f"group-{station}",
                        )
                    )
        return sorted(result, key=lambda item: item.sort_key)

    def track_sections(self, lines: Any, around: Any) -> dict[str, list[TrackSection]]:
        wanted = set(lines)
        sections = super().track_sections(wanted - {TRANSFER_LINE}, around)
        if TRANSFER_LINE in wanted:
            points = self.points
            sections[TRANSFER_LINE] = [
                TrackSection("ls-1", LineString([points["t"], points["x"]])),
                TrackSection("ls-2", LineString([points["x'"], points["y"]])),
            ]
        return sections


def with_transfer_services(
    base: Overrides,
    *,
    transfer_m: float | None = 100.0,
    consumers: bool = False,
    express: bool = False,
) -> Overrides:
    """Add owner ``split`` (t, x, y on LS) and optionally consumers.

    ``split-composed`` composes both hops from ``split``; ``split-mixed``
    composes t -> x and routes x -> y; ``split-routed-first`` routes t -> x and
    composes x -> y. ``split-express`` (t, y) composes across the transfer.
    Every three-stop service gets the same reviewed transfer at x when
    ``transfer_m`` is given.
    """
    template = base.service("owner-b")

    def service(
        identifier: str,
        ranges: tuple[LineRange, ...],
        stops: tuple[str, ...] = ("t", "x", "y"),
    ) -> Any:
        return replace(
            template,
            definition=replace(
                template.definition,
                id=identifier,
                name=identifier,
                expected_stop_count=len(stops),
                length_ref=LengthRef(0.8, 0.5, "Synthetic"),
            ),
            stops=tuple(
                replace(template.stops[0], order=i, station_id=station)
                for i, station in enumerate(stops)
            ),
            line_ranges=ranges,
            scope_stops=tuple(ScopeStop(s, "東京都", "千代田区") for s in stops),
        )

    added = [service("split", (LineRange("t", "y", TRANSFER_LINE),))]
    if consumers:
        compose_tx = LineRange(
            "t", "x", "", compose=recipe(("split", "t", "x", (TRANSFER_LINE,)))
        )
        added += [
            service(
                "split-composed",
                (
                    compose_tx,
                    LineRange(
                        "x",
                        "y",
                        "",
                        compose=recipe(("split", "x", "y", (TRANSFER_LINE,))),
                    ),
                ),
            ),
            service("split-mixed", (compose_tx, LineRange("x", "y", TRANSFER_LINE))),
            service(
                "split-routed-first",
                (
                    LineRange("t", "x", TRANSFER_LINE),
                    LineRange(
                        "x",
                        "y",
                        "",
                        compose=recipe(("split", "x", "y", (TRANSFER_LINE,))),
                    ),
                ),
            ),
        ]
    if express:
        added.append(
            service(
                "split-express",
                (
                    LineRange(
                        "t",
                        "y",
                        "",
                        compose=recipe(("split", "t", "y", (TRANSFER_LINE,))),
                    ),
                ),
                ("t", "y"),
            )
        )
    transfers = (
        ()
        if transfer_m is None
        else tuple(
            PlatformTransfer(item.id, "x", transfer_m, "Reviewed synthetic transfer")
            for item in added
            if "x" in item.station_ids[1:-1]
        )
    )
    return replace(
        base,
        dataset=replace(
            base.dataset,
            service_ids=(*base.dataset.service_ids, *(item.id for item in added)),
        ),
        services=(*base.services, *added),
        registry=replace(
            base.registry,
            stations=(
                *base.registry.stations,
                *(
                    RegistryStation(s, s, s, "東京都", "千代田区", "split")
                    for s in ("x", "y")
                ),
            ),
        ),
        platform_transfers=transfers,
    )
