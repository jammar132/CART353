// =============================================================
// spatialGrid.js; a "spatial hash" so each creature only checks
// things in nearby cells instead of every object in the world.
// This is what keeps hundreds of agents running smoothly.
// =============================================================

class SpatialGrid {
  constructor(w, h, cellSize) {
    this.cell = cellSize;
    this.resize(w, h);
  }

  resize(w, h) {
    this.cols = Math.ceil(w / this.cell) + 1;
    this.rows = Math.ceil(h / this.cell) + 1;
    this.cells = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.cells.push([]);
  }

  clear() {
    for (const c of this.cells) c.length = 0;
  }

  _cx(x) { return U.clamp(Math.floor(x / this.cell), 0, this.cols - 1); }
  _cy(y) { return U.clamp(Math.floor(y / this.cell), 0, this.rows - 1); }

  insert(obj) {
    this.cells[this._cy(obj.pos.y) * this.cols + this._cx(obj.pos.x)].push(obj);
  }

  // Every object whose position is within radius r of (x, y).
  // Pass your own `out` array to avoid allocating a new one each call.
  query(x, y, r, out = []) {
    out.length = 0;
    const x0 = this._cx(x - r), x1 = this._cx(x + r);
    const y0 = this._cy(y - r), y1 = this._cy(y + r);
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.cells[cy * this.cols + cx];
        for (let i = 0; i < cell.length; i++) {
          const o = cell[i];
          const dx = o.pos.x - x, dy = o.pos.y - y;
          if (dx * dx + dy * dy <= r2) out.push(o);
        }
      }
    }
    return out;
  }
}
