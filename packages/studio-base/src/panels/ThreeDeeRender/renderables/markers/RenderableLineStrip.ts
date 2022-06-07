// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";

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

export class RenderableLineStrip extends RenderableMarker {
  geometry: LineGeometry;
  linePrepass: Line2;
  line: Line2;

  constructor(topic: string, marker: Marker, renderer: Renderer) {
    super(topic, marker, renderer);

    this.geometry = new LineGeometry();

    // Stencil and depth pass 1
    const matLinePrepass = linePrepassMaterial(marker, renderer.materialCache);
    this.linePrepass = new Line2(this.geometry, matLinePrepass);
    this.linePrepass.renderOrder = 1;
    this.linePrepass.userData.picking = false;
    this.add(this.linePrepass);

    // Color pass 2
    const matLine = lineMaterial(marker, renderer.materialCache);
    this.line = new Line2(this.geometry, matLine);
    this.line.renderOrder = 2;
    const pickingLineWidth = marker.scale.x * 1.2;
    this.line.userData.pickingMaterial = linePickingMaterial(
      pickingLineWidth,
      true,
      renderer.materialCache,
    );
    this.add(this.line);

    this.update(marker);
  }

  override dispose(): void {
    releaseLinePrepassMaterial(this.userData.marker, this._renderer.materialCache);
    releaseLineMaterial(this.userData.marker, this._renderer.materialCache);

    const pickingLineWidth = this.userData.marker.scale.x * 1.2;
    releaseLinePickingMaterial(pickingLineWidth, true, this._renderer.materialCache);
    this.line.userData.pickingMaterial = undefined;
  }

  override update(marker: Marker): void {
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

    this.linePrepass.computeLineDistances();
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
    // Converts color-per-point to pairs format in a flattened typed array
    const rgbaData = new Float32Array(8 * marker.points.length);
    const color1: THREE.Vector4Tuple = [0, 0, 0, 0];
    this._markerColorsToLinear(marker, (color2, ii) => {
      if (ii === 0) {
        copyTuple4(color2, color1);
        return;
      }
      const i = ii - 1;

      rgbaData[8 * i + 0] = color1[0];
      rgbaData[8 * i + 1] = color1[1];
      rgbaData[8 * i + 2] = color1[2];
      rgbaData[8 * i + 3] = color1[3];

      rgbaData[8 * i + 4] = color2[0];
      rgbaData[8 * i + 5] = color2[1];
      rgbaData[8 * i + 6] = color2[2];
      rgbaData[8 * i + 7] = color2[3];

      copyTuple4(color2, color1);
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

function copyTuple4(from: THREE.Vector4Tuple, to: THREE.Vector4Tuple): void {
  to[0] = from[0];
  to[1] = from[1];
  to[2] = from[2];
  to[3] = from[3];
}
