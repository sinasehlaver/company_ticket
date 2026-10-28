// Loading skeleton in the shape of the view (kit .skeleton shimmer): an optional heading block + N card blocks.
export function Skeleton({ head = false, cards = 3, map = false }) {
  return (
    <div className="sk" aria-busy="true" aria-label="…">
      {head && <div className="skeleton sk-head" />}
      {map ? <div className="skeleton sk-map" /> : (
        <div className="cards-grid">{Array.from({ length: cards }, (_, i) => <div key={i} className="skeleton sk-card" />)}</div>
      )}
    </div>
  );
}
