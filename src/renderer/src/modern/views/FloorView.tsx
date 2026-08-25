import { OfficeFloor } from '@/scene/office/OfficeFloor';

/**
 * The Pixi office scene, mounted AS-IS. `scene/office/**` is a hard boundary in
 * both design systems (DESIGN.md §3.10): it is game art with its own warm
 * palette, and it does not follow the chrome — so the modern UI frames it and
 * changes nothing inside it.
 *
 * OfficeFloor sizes itself to its offset parent, so the wrapper is what decides
 * the stage: `inset-0` inside a positioned, min-height-0 flex child.
 */
export function FloorView() {
  return (
    <div className="h-full min-h-0 p-4">
      <div className="relative h-full min-h-0 overflow-hidden rounded-lg border">
        <OfficeFloor />
      </div>
    </div>
  );
}
