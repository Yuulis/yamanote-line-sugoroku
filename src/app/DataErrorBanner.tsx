import type { DataFileName } from "../data/loaders";

interface DataErrorBannerProps {
  failures: { file: DataFileName; reason: string }[];
}

export function DataErrorBanner({ failures }: DataErrorBannerProps) {
  if (failures.length === 0) return null;
  const detail = failures
    .map(({ file, reason }) => `${file}（${reason}）`)
    .join("、");
  return (
    <div className="data-error-banner" role="status">
      データの読み込みに失敗しました: {detail}
    </div>
  );
}
