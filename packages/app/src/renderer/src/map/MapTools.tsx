import { Icon } from '../ui/Icon.tsx'

/** The tool group at the top left of the map: zoom out, zoom in, fit, and where you are. */
export function MapTools({
  level,
  zoomOutLabel,
  fitLabel,
  onZoomOut,
  onZoomIn,
  onFit,
}: {
  level: string
  zoomOutLabel: string
  fitLabel: string
  onZoomOut: () => void
  onZoomIn: () => void
  onFit: () => void
}) {
  return (
    <div className="map-tools" role="group" aria-label="Map tools">
      <button
        type="button"
        className="icon-btn"
        aria-label={zoomOutLabel}
        title={zoomOutLabel}
        onClick={onZoomOut}
      >
        <Icon name="minus" />
      </button>
      <span className="map-tools-sep" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn"
        aria-label="Zoom in"
        title="Zoom in"
        onClick={onZoomIn}
      >
        <Icon name="plus" />
      </button>
      <span className="map-tools-sep" aria-hidden="true" />
      <button
        type="button"
        className="icon-btn"
        aria-label={fitLabel}
        title={fitLabel}
        onClick={onFit}
      >
        <Icon name="fit" />
      </button>
      <span className="map-tools-level" aria-live="polite">
        {level}
      </span>
    </div>
  )
}
