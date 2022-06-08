// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";

import type { Renderer } from "../../Renderer";
import { approxEquals } from "../../math";
import { Marker } from "../../ros";
import { RenderableMarker } from "./RenderableMarker";
import {
  lineMaterial,
  linePrepassMaterial,
  linePickingMaterial,
  markerHasTransparency,
  releaseLineMaterial,
  releaseLinePrepassMaterial,
  releaseLinePickingMaterial,
} from "./materials";

const MIN_PICKING_LINE_SIZE = 6;

export class RenderableLineList extends RenderableMarker {
  geometry: LineSegmentsGeometry;
  linePrepass: LineSegments2;
  line: LineSegments2;

  constructor(topic: string, marker: Marker, renderer: Renderer) {
    super(topic, marker, renderer);

    this.geometry = new LineSegmentsGeometry();

    // Stencil and depth pass 1
    const matLinePrepass = linePrepassMaterial(marker, renderer.materialCache);
    this.linePrepass = new LineSegments2(this.geometry, matLinePrepass);
    this.linePrepass.renderOrder = 1;
    this.linePrepass.userData.picking = false;
    this.add(this.linePrepass);

    // Color pass 2
    const matLine = lineMaterial(marker, renderer.materialCache);
    this.line = new LineSegments2(this.geometry, matLine);
    this.line.renderOrder = 2;
    const pickingLineWidth = Math.max(marker.scale.x, MIN_PICKING_LINE_SIZE);
    this.line.userData.pickingMaterial = linePickingMaterial(
      pickingLineWidth,
      renderer.materialCache,
    );
    this.add(this.line);

    this.update(marker);
  }

  override dispose(): void {
    releaseLinePrepassMaterial(this.userData.marker, this._renderer.materialCache);
    releaseLineMaterial(this.userData.marker, this._renderer.materialCache);

    const pickingLineWidth = Math.max(this.userData.marker.scale.x, MIN_PICKING_LINE_SIZE);
    releaseLinePickingMaterial(pickingLineWidth, this._renderer.materialCache);
    this.line.userData.pickingMaterial = undefined;

    this.geometry.dispose();
  }

  override update(marker: Marker): void {
    if (marker.points.length % 2 !== 0) {
      throw new Error(`LineList marker has odd number of points (${marker.points.length})`);
    }

    const prevMarker = this.userData.marker;
    super.update(marker);

    const prevLineWidth = prevMarker.scale.x;
    const prevTransparent = markerHasTransparency(prevMarker);
    const lineWidth = marker.scale.x;
    const transparent = markerHasTransparency(marker);

    if (!approxEquals(prevLineWidth, lineWidth) || prevTransparent !== transparent) {
      releaseLinePrepassMaterial(prevMarker, this._renderer.materialCache);
      releaseLineMaterial(prevMarker, this._renderer.materialCache);
      this.linePrepass.material = linePrepassMaterial(marker, this._renderer.materialCache);
      this.line.material = lineMaterial(marker, this._renderer.materialCache);
    }

    this._setPositions(marker);
    this._setColors(marker);

    // These both update the same `LineSegmentsGeometry` reference, so no need to call both
    // this.linePrepass.computeLineDistances();
    this.line.computeLineDistances();
  }

  private _setPositions(marker: Marker): void {
    const linePositions = new Float32Array(3 * marker.points.length);
    for (let i = 0; i < marker.points.length; i++) {
      const point = marker.points[i]!;
      linePositions[i * 3 + 0] = point.x;
      linePositions[i * 3 + 1] = point.y;
      linePositions[i * 3 + 2] = point.z;
    }

    this.geometry.setPositions(linePositions);
  }

  private _setColors(marker: Marker): void {
    // Converts color-per-point to a flattened typed array
    const rgbaData = new Float32Array(4 * marker.points.length);
    this._markerColorsToLinear(marker, (color, i) => {
      rgbaData[4 * i + 0] = color[0];
      rgbaData[4 * i + 1] = color[1];
      rgbaData[4 * i + 2] = color[2];
      rgbaData[4 * i + 3] = color[3];
    });

    // [rgba, rgba]
    const instanceColorBuffer = new THREE.InstancedInterleavedBuffer(rgbaData, 8, 1);
    this.geometry.setAttribute(
      "instanceColorStart",
      new THREE.InterleavedBufferAttribute(instanceColorBuffer, 4, 0),
    );
    this.geometry.setAttribute(
      "instanceColorEnd",
      new THREE.InterleavedBufferAttribute(instanceColorBuffer, 4, 4),
    );
  }
}
