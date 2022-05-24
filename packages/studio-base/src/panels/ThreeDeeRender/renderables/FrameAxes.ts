// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";

import Logger from "@foxglove/log";
import { SettingsTreeFields } from "@foxglove/studio-base/components/SettingsTreeEditor/types";

import { MaterialCache, StandardColor } from "../MaterialCache";
import { Renderer } from "../Renderer";
import { arrowHeadSubdivisions, arrowShaftSubdivisions, DetailLevel } from "../lod";
import { Pose, rosTimeToNanoSec, TF } from "../ros";
import { LayerSettingsTransform, LayerType } from "../settings";
import { Transform } from "../transforms/Transform";
import { makePose } from "../transforms/geometry";
import { Duration } from "../transforms/time";
import { updatePose } from "../updatePose";
import { linePickingMaterial, releaseLinePickingMaterial } from "./markers/materials";
import { missingTransformMessage, MISSING_TRANSFORM } from "./transforms";

const log = Logger.getLogger(__filename);

const SHAFT_LENGTH = 0.154;
const SHAFT_DIAMETER = 0.02;
const HEAD_LENGTH = 0.046;
const HEAD_DIAMETER = 0.05;

const RED_COLOR = new THREE.Color(0x9c3948).convertSRGBToLinear();
const GREEN_COLOR = new THREE.Color(0x88dd04).convertSRGBToLinear();
const BLUE_COLOR = new THREE.Color(0x2b90fb).convertSRGBToLinear();
const YELLOW_COLOR = new THREE.Color(0xffff00).convertSRGBToLinear();

const PI_2 = Math.PI / 2;

const PICKING_LINE_SIZE = 6;

const DEFAULT_SETTINGS: LayerSettingsTransform = {
  visible: true,
};

const INFINITE_DURATION: Duration = 4_294_967_295n * BigInt(1e9);

const tempMat4 = new THREE.Matrix4();
const tempVec = new THREE.Vector3();
const tempVecB = new THREE.Vector3();

const tempLower: [Duration, Transform] = [0n, Transform.Identity()];
const tempUpper: [Duration, Transform] = [0n, Transform.Identity()];
const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

type FrameAxisRenderable = THREE.Object3D & {
  userData: {
    frameId: string;
    pose: Pose;
    settings: LayerSettingsTransform;
    shaftMesh: THREE.InstancedMesh;
    headMesh: THREE.InstancedMesh;
    label: THREE.Sprite;
    parentLine?: Line2;
  };
};

export class FrameAxes extends THREE.Object3D {
  private static shaftLod: DetailLevel | undefined;
  private static headLod: DetailLevel | undefined;
  private static shaftGeometry: THREE.CylinderGeometry | undefined;
  private static headGeometry: THREE.ConeGeometry | undefined;
  private static lineGeometry: LineGeometry | undefined;

  renderer: Renderer;
  axesByFrameId = new Map<string, FrameAxisRenderable>();
  lineMaterial: LineMaterial;
  linePickingMaterial: THREE.ShaderMaterial;

  constructor(renderer: Renderer) {
    super();
    this.renderer = renderer;

    this.lineMaterial = new LineMaterial({ linewidth: 2 });
    this.lineMaterial.color = YELLOW_COLOR;

    this.linePickingMaterial = linePickingMaterial(PICKING_LINE_SIZE, this.renderer.materialCache);

    renderer.setSettingsNodeProvider(LayerType.Transform, (_tfConfig, { name: frameId }) => {
      // const cur = tfConfig as Partial<LayerSettingsTransform>;
      let ageValue: string | undefined;
      let xyzValue: THREE.Vector3Tuple | undefined;
      let rpyValue: THREE.Vector3Tuple | undefined;
      const currentTime = this.renderer.currentTime;
      const frame = this.renderer.transformTree.frame(frameId);
      const parentFrameId = frame?.parent()?.id;

      if (parentFrameId == undefined) {
        return {
          fields: {
            parent: { label: "Parent", input: "string", value: "<root>" },
          },
        };
      }

      if (currentTime != undefined && frame) {
        if (frame.findClosestTransforms(tempLower, tempUpper, currentTime, INFINITE_DURATION)) {
          const [transformTime, transform] = tempUpper;
          ageValue =
            transformTime < currentTime ? formatShortDuration(currentTime - transformTime) : "0 ns";
          const p = transform.position() as THREE.Vector3Tuple;
          const q = transform.rotation() as THREE.Vector4Tuple;
          xyzValue = [round(p[0], 3), round(p[1], 3), round(p[2], 3)];
          tempQuaternion.set(q[0], q[1], q[2], q[3]);
          tempEuler.setFromQuaternion(tempQuaternion, "XYZ");
          rpyValue = [
            round(THREE.MathUtils.radToDeg(tempEuler.x), 3),
            round(THREE.MathUtils.radToDeg(tempEuler.y), 3),
            round(THREE.MathUtils.radToDeg(tempEuler.z), 3),
          ];
        }
      }

      const fields: SettingsTreeFields = {
        parent: {
          label: "Parent",
          input: "string",
          value: parentFrameId,
        },
        age: {
          label: "Age",
          input: "string",
          value: ageValue,
        },
        xyz: {
          label: "Translation",
          input: "vec3",
          value: xyzValue,
          precision: 3,
          labels: ["X", "Y", "Z"],
        },
        rpy: {
          label: "Rotation",
          input: "vec3",
          value: rpyValue,
          labels: ["R", "P", "Y"],
        },
      };

      return { fields };
    });
  }

  dispose(): void {
    for (const renderable of this.axesByFrameId.values()) {
      releaseStandardMaterial(this.renderer.materialCache);
      renderable.userData.shaftMesh.dispose();
      renderable.userData.headMesh.dispose();
      this.renderer.labels.removeById(`tf:${renderable.userData.frameId}`);
      renderable.children.length = 0;
    }
    this.children.length = 0;
    this.axesByFrameId.clear();
    this.lineMaterial.dispose();
    releaseLinePickingMaterial(PICKING_LINE_SIZE, this.renderer.materialCache);
  }

  addTransformMessage(tf: TF): void {
    const addParent = !this.renderer.transformTree.hasFrame(tf.header.frame_id);
    const addChild = !this.renderer.transformTree.hasFrame(tf.child_frame_id);

    // Create a new transform and add it to the renderer's TransformTree
    const stamp = rosTimeToNanoSec(tf.header.stamp);
    const t = tf.transform.translation;
    const q = tf.transform.rotation;
    const transform = new Transform([t.x, t.y, t.z], [q.x, q.y, q.z, q.w]);
    this.renderer.transformTree.addTransform(
      tf.child_frame_id,
      tf.header.frame_id,
      stamp,
      transform,
    );

    if (addParent) {
      this._addFrameAxis(tf.header.frame_id);
    }
    if (addChild) {
      this._addFrameAxis(tf.child_frame_id);
    }

    if (addParent || addChild) {
      log.debug(`Added transform "${tf.header.frame_id}_T_${tf.child_frame_id}"`);
      this.renderer.emit("transformTreeUpdated", this.renderer);
    }
  }

  setTransformSettings(frameId: string, settings: Partial<LayerSettingsTransform>): void {
    const renderable = this.axesByFrameId.get(frameId);
    if (renderable) {
      renderable.userData.settings = { ...renderable.userData.settings, ...settings };
    }
  }

  startFrame(currentTime: bigint): void {
    this.lineMaterial.resolution = this.renderer.input.canvasSize;

    const renderFrameId = this.renderer.renderFrameId;
    const fixedFrameId = this.renderer.fixedFrameId;
    if (renderFrameId == undefined || fixedFrameId == undefined) {
      this.visible = false;
      return;
    }
    this.visible = true;

    // Update the arrow poses
    for (const [frameId, renderable] of this.axesByFrameId.entries()) {
      renderable.visible = renderable.userData.settings.visible;
      if (!renderable.visible) {
        continue;
      }

      const updated = updatePose(
        renderable,
        this.renderer.transformTree,
        renderFrameId,
        fixedFrameId,
        frameId,
        currentTime,
        currentTime,
      );
      renderable.visible = updated;
      if (!updated) {
        const message = missingTransformMessage(renderFrameId, fixedFrameId, frameId);
        this.renderer.layerErrors.addToLayer(`f:${frameId}`, MISSING_TRANSFORM, message);
      }
    }

    // Update the lines between coordinate frames
    for (const [_frameId, childRenderable] of this.axesByFrameId.entries()) {
      const line = childRenderable.userData.parentLine;
      if (line) {
        line.visible = false;
        const childFrame = this.renderer.transformTree.frame(childRenderable.userData.frameId);
        const parentFrame = childFrame?.parent();
        if (parentFrame) {
          const parentRenderable = this.axesByFrameId.get(parentFrame.id);
          if (parentRenderable?.visible === true) {
            parentRenderable.getWorldPosition(tempVec);
            const dist = tempVec.distanceTo(childRenderable.getWorldPosition(tempVecB));
            line.lookAt(tempVec);
            line.rotateY(-PI_2);
            line.scale.set(dist, 1, 1);
            line.visible = true;
          }
        }
      }
    }
  }

  private _addFrameAxis(frameId: string): void {
    if (this.axesByFrameId.has(frameId)) {
      return;
    }

    // Create a scene graph object to hold the three arrows, a text label, and a
    // line to the parent frame if it exists
    const renderable = new THREE.Object3D() as FrameAxisRenderable;
    renderable.name = frameId;

    // Create three arrow shafts
    const arrowMaterial = standardMaterial(this.renderer.materialCache);
    const shaftGeometry = FrameAxes.ShaftGeometry(this.renderer.maxLod);
    const shaftInstances = new THREE.InstancedMesh(shaftGeometry, arrowMaterial, 3);
    shaftInstances.castShadow = true;
    shaftInstances.receiveShadow = true;
    renderable.add(shaftInstances);
    // Set x, y, and z axis arrow shaft directions
    tempVec.set(SHAFT_LENGTH, SHAFT_DIAMETER, SHAFT_DIAMETER);
    shaftInstances.setMatrixAt(0, tempMat4.identity().scale(tempVec));
    shaftInstances.setMatrixAt(1, tempMat4.makeRotationZ(PI_2).scale(tempVec));
    shaftInstances.setMatrixAt(2, tempMat4.makeRotationY(-PI_2).scale(tempVec));
    shaftInstances.setColorAt(0, RED_COLOR);
    shaftInstances.setColorAt(1, GREEN_COLOR);
    shaftInstances.setColorAt(2, BLUE_COLOR);

    // Create three arrow heads
    const headGeometry = FrameAxes.HeadGeometry(this.renderer.maxLod);
    const headInstances = new THREE.InstancedMesh(headGeometry, arrowMaterial, 3);
    headInstances.castShadow = true;
    headInstances.receiveShadow = true;
    renderable.add(headInstances);
    // Set x, y, and z axis arrow head directions
    tempVec.set(HEAD_LENGTH, HEAD_DIAMETER, HEAD_DIAMETER);
    tempMat4.identity().scale(tempVec).setPosition(SHAFT_LENGTH, 0, 0);
    headInstances.setMatrixAt(0, tempMat4);
    tempMat4.makeRotationZ(PI_2).scale(tempVec).setPosition(0, SHAFT_LENGTH, 0);
    headInstances.setMatrixAt(1, tempMat4);
    tempMat4.makeRotationY(-PI_2).scale(tempVec).setPosition(0, 0, SHAFT_LENGTH);
    headInstances.setMatrixAt(2, tempMat4);
    headInstances.setColorAt(0, RED_COLOR);
    headInstances.setColorAt(1, GREEN_COLOR);
    headInstances.setColorAt(2, BLUE_COLOR);

    const frame = this.renderer.transformTree.frame(frameId);
    if (!frame) {
      throw new Error(`CoordinateFrame "${frameId}" was not created`);
    }

    // Text label
    const label = this.renderer.labels.setLabel(`tf:${frameId}`, { text: frameId });
    label.position.set(0, 0, 0.4);
    renderable.add(label);

    // Set the initial settings from default values merged with any user settings
    const userSettings = this.renderer.config.transforms[frameId] as
      | Partial<LayerSettingsTransform>
      | undefined;
    const settings = { ...DEFAULT_SETTINGS, ...userSettings };

    renderable.userData = {
      frameId,
      pose: makePose(),
      settings,
      shaftMesh: shaftInstances,
      headMesh: headInstances,
      label,
      parentLine: undefined,
    };

    // Check if this frame's parent exists
    const parentFrame = frame.parent();
    if (parentFrame) {
      const parentRenderable = this.axesByFrameId.get(parentFrame.id);
      if (parentRenderable) {
        this._addChildParentLine(renderable);
      }
    }

    // Find all children of this frame
    for (const curFrame of this.renderer.transformTree.frames().values()) {
      if (curFrame.parent() === frame) {
        const curRenderable = this.axesByFrameId.get(curFrame.id);
        if (curRenderable) {
          this._addChildParentLine(curRenderable);
        }
      }
    }

    this.add(renderable);
    this.axesByFrameId.set(frameId, renderable);
  }

  private _addChildParentLine(renderable: FrameAxisRenderable): void {
    if (renderable.userData.parentLine) {
      renderable.remove(renderable.userData.parentLine);
    }
    const line = new Line2(FrameAxes.LineGeometry(), this.lineMaterial);
    line.castShadow = true;
    line.receiveShadow = false;
    line.userData.pickingMaterial = this.linePickingMaterial;

    renderable.add(line);
    renderable.userData.parentLine = line;
  }

  static ShaftGeometry(lod: DetailLevel): THREE.CylinderGeometry {
    if (!FrameAxes.shaftGeometry || lod !== FrameAxes.shaftLod) {
      const subdivs = arrowShaftSubdivisions(lod);
      FrameAxes.shaftGeometry = new THREE.CylinderGeometry(0.5, 0.5, 1, subdivs, 1, false);
      FrameAxes.shaftGeometry.rotateZ(-PI_2);
      FrameAxes.shaftGeometry.translate(0.5, 0, 0);
      FrameAxes.shaftGeometry.computeBoundingSphere();
      FrameAxes.shaftLod = lod;
    }
    return FrameAxes.shaftGeometry;
  }

  static HeadGeometry(lod: DetailLevel): THREE.ConeGeometry {
    if (!FrameAxes.headGeometry || lod !== FrameAxes.headLod) {
      const subdivs = arrowHeadSubdivisions(lod);
      FrameAxes.headGeometry = new THREE.ConeGeometry(0.5, 1, subdivs, 1, false);
      FrameAxes.headGeometry.rotateZ(-PI_2);
      FrameAxes.headGeometry.translate(0.5, 0, 0);
      FrameAxes.headGeometry.computeBoundingSphere();
      FrameAxes.headLod = lod;
    }
    return FrameAxes.headGeometry;
  }

  static LineGeometry(): LineGeometry {
    if (!FrameAxes.lineGeometry) {
      FrameAxes.lineGeometry = new LineGeometry();
      FrameAxes.lineGeometry.setPositions([0, 0, 0, 1, 0, 0]);
    }
    return FrameAxes.lineGeometry;
  }
}

const COLOR_WHITE = { r: 1, g: 1, b: 1, a: 1 };

function standardMaterial(materialCache: MaterialCache): THREE.MeshStandardMaterial {
  return materialCache.acquire(
    StandardColor.id(COLOR_WHITE),
    () => StandardColor.create(COLOR_WHITE),
    StandardColor.dispose,
  );
}

function releaseStandardMaterial(materialCache: MaterialCache): void {
  materialCache.release(StandardColor.id(COLOR_WHITE));
}

const MS_NS = BigInt(1e6);
const SEC_NS = BigInt(1e9);
const MIN_NS = BigInt(6e10);
const HOUR_NS = BigInt(3.6e12);

function formatShortDuration(duration: Duration): string {
  const absDuration = abs(duration);
  if (absDuration < MS_NS) {
    return `${duration} ns`;
  } else if (absDuration < SEC_NS) {
    return `${Number(duration / MS_NS).toFixed(1)} ms`;
  } else if (absDuration < MIN_NS) {
    return `${Number(duration / SEC_NS).toFixed(1)} s`;
  } else if (absDuration < HOUR_NS) {
    return `${Number(duration / MIN_NS).toFixed(1)} min`;
  } else {
    return `${Number(duration / HOUR_NS).toFixed(1)} hr`;
  }
}

function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

function round(x: number, precision: number): number {
  return Number(x.toFixed(precision));
}
