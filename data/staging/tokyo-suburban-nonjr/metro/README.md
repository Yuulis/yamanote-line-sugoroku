# metro non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`.

Enter primary-source operating-mileage evidence in `length-refs.csv` and `length-ref-components.csv`, then complete the reviewed stop selectors and route mappings before running `measure-pairs`. Verification status belongs in the group verification log under `.claude/logs/s3/metro/`; this README records only the log pointer.

## Shared station municipality evidence

For shared Tokyo Metro station IDs, service `scope.csv` uses the frozen registry municipality selected from the representative service. Tokyo Metro's Iidabashi station page lists the Yurakucho and Namboku facilities at Shinjuku-ku, Kagurazaka 1-13, and the Tozai facility at Chiyoda-ku, Iidabashi 4-10-3: https://www.tokyometro.jp/station/iidabashi/index.html. The `metro-iidabashi` registry value is Chiyoda-ku (representative `metro-tozai`), so the Yurakucho and Namboku scope rows retain Chiyoda-ku while this platform-level Shinjuku-ku evidence is recorded here.

The `metro-tameike-sanno` registry value is Minato-ku (representative `metro-ginza`), so its Namboku scope row uses Minato-ku. Tokyo Metro's station page gives the shared Ginza/Namboku station address as Chiyoda-ku, Nagatacho 2-11-1: https://www.tokyometro.jp/station/tameike-sanno/index.html. This platform-level address is recorded here; the frozen registry municipality remains the scope value.
