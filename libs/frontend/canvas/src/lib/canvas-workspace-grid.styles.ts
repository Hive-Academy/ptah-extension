/** Base styles of the workspace grid host and its Gridstack items. */
export const canvasWorkspaceGridStyles = `
      gridstack {
        min-height: 200px;
        height: 100%;
      }

      gridstack.singleton {
        height: 100% !important;
      }

      /* Keep full-height singletons tall; Gridstack owns their chosen width. */
      gridstack.singleton:not(.compact-singleton) > gridstack-item {
        height: 100% !important;
      }

      :host
        ::ng-deep
        gridstack-item.ui-resizable-disabled
        > .ui-resizable-handle {
        display: none !important;
      }

      /* Gridstack creates one handle set for every item; each tile shows only
         the edges it can write: a compact tile its height (south), a full
         tile its span (east and west). */
      :host ::ng-deep gridstack-item.ptah-compact-item > .ui-resizable-e,
      :host ::ng-deep gridstack-item.ptah-compact-item > .ui-resizable-w,
      :host ::ng-deep gridstack-item:not(.ptah-compact-item) > .ui-resizable-s {
        display: none !important;
      }

      gridstack.singleton .tile-header {
        cursor: default !important;
      }
    `;

/**
 * Detail-row overlay (B6 option b): the slot is a sibling of `gridstack`, not
 * a Gridstack node. Rows below the opened row move down by the slot height.
 */
export const canvasDetailStyles = `
  :host { position: relative; }
  gridstack { padding-bottom: var(--ptah-detail-h, 0px); }
  .ptah-detail-slot {
    position: absolute;
    left: 0;
    right: 0;
    z-index: 1;
  }
  :host ::ng-deep gridstack-item.ptah-below-detail {
    transform: translateY(var(--ptah-detail-h));
  }
`;
