# tobu non-JR staging dataset

This isolated stage is seeded from the hash-verified S0 catalog. Build inputs are split by operator and stop-connected component under `components/`.

The Koizumi branch operating-mileage references use the Kanto District Transport Bureau's official railway list, `JR以外 鉄道一覧` (p. 4, R6.3.31), which records 館林–西小泉 as 12.0 km and 太田–東小泉 as 6.4 km. These add to Tobu's official 18.4 km Koizumi Line total in its [route overview](https://www.tobu.co.jp/corporation/rail/route/); the N02 pair sums are 11.837 km and 6.273 km, respectively, both within 1.5 km.

The requested [Tobu fare PDF](https://www.tobu.co.jp/cms-pdf/news/20230308173821gOeil5pz8zABtXdhXxcI8g.pdf), p. 2 `営業キロ程一覧表`, contains a Koizumi station-kilometer chain, including 館林 0.0 and 西小泉 13.2. Those station-kilometer values do not reconcile to the operating-line mileage published by Tobu and the Kanto District Transport Bureau, so the fare table is recorded as a cross-check and is not used for these two `lengthRef` values. The cited [Kanto District Transport Bureau railway list](https://wwwtb.mlit.go.jp/kanto/content/000340764.pdf) is the selected primary operating-mileage source.

Verification status belongs in `.claude/logs/s3/tobu/`; this README records the source basis and verification log pointer.
