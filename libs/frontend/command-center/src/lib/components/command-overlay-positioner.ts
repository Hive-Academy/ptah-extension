import type { Rect, SceneGeometry } from '../scene/connector-geometry';
import { findHoverPreviewPlacement, placePinnedPlate, type PinnedPlatePlacement, type PlateMode } from './command-overlay-placement';

/** Converts stage-local plate geometry to viewport coordinates for the fixed plate. */
export class CommandOverlayPositioner {
  public pinned(
    geometry: SceneGeometry,
    id: string,
    anchorKind: 'stream' | 'root',
    height: number,
    previousMode: PlateMode | null = null,
  ): PinnedPlatePlacement | null {
    return placePinnedPlate(geometry, id, anchorKind, height, previousMode);
  }

  public preview(
    geometry: SceneGeometry,
    id: string,
    height: number,
    anchorKind: 'stream' | 'root',
  ): Rect | null {
    return findHoverPreviewPlacement(geometry, id, height, null, anchorKind);
  }

  public apply(card: HTMLElement, stage: HTMLElement, plate: Rect, scrollInsidePlate = false): void {
    const stageRect = stage.getBoundingClientRect();
    card.style.left = `${stageRect.left + plate.x}px`;
    card.style.top = `${stageRect.top + plate.y}px`;
    card.style.width = `${plate.width}px`;
    card.style.maxHeight = scrollInsidePlate ? `${plate.height}px` : '';
    card.style.overflowY = scrollInsidePlate ? 'auto' : '';
    card.style.visibility = 'visible';
  }
}
