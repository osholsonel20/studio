// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { CameraState, DEFAULT_CAMERA_STATE } from "@foxglove/regl-worldview";
import { Topic } from "@foxglove/studio";
import {
  SettingsTreeChildren,
  SettingsTreeNode,
  SettingsTreeRoots,
} from "@foxglove/studio-base/components/SettingsTreeEditor/types";

import { NodeError } from "./LayerErrors";
import {
  CAMERA_INFO_DATATYPES,
  IMAGE_DATATYPES,
  COMPRESSED_IMAGE_DATATYPES,
  MARKER_ARRAY_DATATYPES,
  MARKER_DATATYPES,
  OCCUPANCY_GRID_DATATYPES,
  POINTCLOUD_DATATYPES,
  POSE_STAMPED_DATATYPES,
  POSE_WITH_COVARIANCE_STAMPED_DATATYPES,
  TF_DATATYPES,
  TRANSFORM_STAMPED_DATATYPES,
} from "./ros";

export type LayerSettingsTransform = {
  visible: boolean;
};

export type ThreeDeeRenderConfig = {
  cameraState: CameraState;
  followTf: string | undefined;
  scene: {
    enableStats?: boolean;
    backgroundColor?: string;
  };
  transforms: Record<string, LayerSettingsTransform>;
  topics: Record<string, Record<string, unknown> | undefined>;
};

export type SelectEntry = { label: string; value: string };

export type LayerSettingsMarkerNamespace = {
  visible: boolean;
};

export type LayerSettingsMarker = {
  visible: boolean;
  namespaces: Record<string, LayerSettingsMarkerNamespace>;
};

export type LayerSettingsOccupancyGrid = {
  visible: boolean;
  minColor: string;
  maxColor: string;
  unknownColor: string;
  invalidColor: string;
  frameLocked: boolean;
};

export type LayerSettingsPointCloud2 = {
  visible: boolean;
  pointSize: number;
  pointShape: "circle" | "square";
  decayTime: number;
  colorMode: "flat" | "gradient" | "colormap" | "rgb" | "rgba";
  flatColor: string;
  colorField: string | undefined;
  gradient: [string, string];
  colorMap: "turbo" | "rainbow";
  rgbByteOrder: "rgba" | "bgra" | "abgr";
  minValue: number | undefined;
  maxValue: number | undefined;
};

export type LayerSettingsPose = {
  visible: boolean;
  scale: [number, number, number];
  color: string;
  showCovariance: boolean;
  covarianceColor: string;
};

export type LayerSettingsCameraInfo = {
  visible: boolean;
  distance: number;
  width: number;
  color: string;
};

export type LayerSettingsImage = {
  visible: boolean;
  cameraInfoTopic: string | undefined;
  distance: number;
  color: string;
};

export type LayerSettings =
  | LayerSettingsMarker
  | LayerSettingsOccupancyGrid
  | LayerSettingsPointCloud2
  | LayerSettingsPose
  | LayerSettingsCameraInfo
  | LayerSettingsImage;

export enum LayerType {
  Transform,
  Marker,
  OccupancyGrid,
  PointCloud,
  Pose,
  CameraInfo,
  Image,
}

export type SettingsNodeProvider = (
  topicConfig: Partial<LayerSettings>,
  topic: Topic,
) => SettingsTreeNode;

export const SUPPORTED_DATATYPES = new Set<string>();
mergeSetInto(SUPPORTED_DATATYPES, TRANSFORM_STAMPED_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, TF_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, MARKER_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, MARKER_ARRAY_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, OCCUPANCY_GRID_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, POINTCLOUD_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, POSE_STAMPED_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, POSE_WITH_COVARIANCE_STAMPED_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, CAMERA_INFO_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, IMAGE_DATATYPES);
mergeSetInto(SUPPORTED_DATATYPES, COMPRESSED_IMAGE_DATATYPES);

const ONE_DEGREE = Math.PI / 180;

// This is the unused topic parameter passed to the SettingsNodeProvider for
// LayerType.Transform, since transforms do not map 1:1 to topics
const EMPTY_TOPIC = { name: "", datatype: "" };

const PATH_GENERAL = ["general"];
const PATH_SCENE = ["scene"];
const PATH_CAMERA_STATE = ["cameraState"];
const PATH_TRANSFORMS = ["transforms"];
const PATH_TOPICS = ["topics"];

export type SettingsTreeOptions = {
  config: ThreeDeeRenderConfig;
  coordinateFrames: ReadonlyArray<SelectEntry>;
  layerErrors: NodeError;
  followTf: string | undefined;
  topics: ReadonlyArray<Topic>;
  topicsToLayerTypes: Map<string, LayerType>;
  settingsNodeProviders: Map<LayerType, SettingsNodeProvider>;
};

function buildTransformNode(
  tfConfigOrFrameId: string | Partial<LayerSettingsTransform>,
  frameDisplayName: string,
  settingsNodeProvider: SettingsNodeProvider,
): undefined | SettingsTreeNode {
  const tfConfig = typeof tfConfigOrFrameId === "string" ? {} : tfConfigOrFrameId;
  const node = settingsNodeProvider(tfConfig, EMPTY_TOPIC);
  node.label ??= frameDisplayName;
  node.visible ??= tfConfig.visible ?? true;
  node.defaultExpansionState ??= "collapsed";
  return node;
}

function buildTopicNode(
  topicConfigOrTopicName: string | Partial<LayerSettings>,
  topic: Topic,
  layerType: LayerType,
  settingsNodeProvider: SettingsNodeProvider,
): undefined | SettingsTreeNode {
  // Transform settings are handled elsewhere
  if (layerType === LayerType.Transform) {
    return;
  }

  const topicConfig = typeof topicConfigOrTopicName === "string" ? {} : topicConfigOrTopicName;
  const node = settingsNodeProvider(topicConfig, topic);
  node.label ??= topic.name;
  node.visible ??= topicConfig.visible ?? true;
  node.defaultExpansionState ??= "collapsed";
  return node;
}

export function buildSettingsTree(options: SettingsTreeOptions): SettingsTreeRoots {
  const {
    config,
    coordinateFrames,
    layerErrors,
    followTf,
    topics,
    topicsToLayerTypes,
    settingsNodeProviders,
  } = options;
  const { cameraState, scene } = config;
  const { backgroundColor } = scene;

  // Build the settings tree for transforms
  const transformsChildren: SettingsTreeChildren = {};
  const tfSettingsNodeProvider = settingsNodeProviders.get(LayerType.Transform);
  if (tfSettingsNodeProvider != undefined) {
    for (const { label: frameName, value: frameId } of options.coordinateFrames) {
      // We key our memoized function by the first argument. Since the config
      // may be undefined we use the config or the topic name
      const transformConfig = config.transforms[frameId] ?? frameId;
      const newNode = buildTransformNode(transformConfig, frameName, tfSettingsNodeProvider);
      if (newNode) {
        newNode.error = layerErrors.errorAtPath(["transforms", frameId]);
        transformsChildren[frameId] = newNode;
      }
    }
  }

  // Build the settings tree for topics
  const topicsChildren: SettingsTreeChildren = {};
  const sortedTopics = sorted(topics, (a, b) => a.name.localeCompare(b.name));
  for (const topic of sortedTopics) {
    const layerType = topicsToLayerTypes.get(topic.name);
    if (layerType == undefined) {
      continue;
    }
    const settingsNodeProvider = settingsNodeProviders.get(layerType);
    if (settingsNodeProvider == undefined) {
      continue;
    }
    // We key our memoized function by the first argument. Since the config
    // may be undefined we use the config or the topic name
    const topicConfig = config.topics[topic.name] ?? topic.name;
    const newNode = buildTopicNode(topicConfig, topic, layerType, settingsNodeProvider);
    if (newNode) {
      newNode.error = layerErrors.errorAtPath(["topics", topic.name]);
      topicsChildren[topic.name] = newNode;
    }
  }

  return {
    general: {
      error: layerErrors.errorAtPath(PATH_GENERAL),
      label: "General",
      icon: "Settings",
      fields: {
        followTf: { label: "Frame", input: "select", options: coordinateFrames, value: followTf },
      },
    },
    scene: {
      error: layerErrors.errorAtPath(PATH_SCENE),
      label: "Scene",
      fields: {
        enableStats: { label: "Render stats", input: "boolean", value: config.scene.enableStats },
        backgroundColor: { label: "Color", input: "rgb", value: backgroundColor },
      },
      defaultExpansionState: "collapsed",
    },
    cameraState: {
      error: layerErrors.errorAtPath(PATH_CAMERA_STATE),
      label: "Camera",
      fields: {
        distance: { label: "Distance", input: "number", value: cameraState.distance, step: 1 },
        perspective: { label: "Perspective", input: "boolean", value: cameraState.perspective },
        targetOffset: {
          label: "Target",
          input: "vec3",
          labels: ["X", "Y", "Z"],
          value: cameraState.targetOffset,
        },
        thetaOffset: {
          label: "Theta",
          input: "number",
          value: cameraState.thetaOffset,
          step: ONE_DEGREE,
        },
        phi: { label: "Phi", input: "number", value: cameraState.phi, step: ONE_DEGREE },
        fovy: { label: "Y-Axis FOV", input: "number", value: cameraState.fovy, step: ONE_DEGREE },
        near: {
          label: "Near",
          input: "number",
          value: cameraState.near,
          step: DEFAULT_CAMERA_STATE.near,
        },
        far: { label: "Far", input: "number", value: cameraState.far, step: 1 },
      },
      defaultExpansionState: "collapsed",
    },
    transforms: {
      error: layerErrors.errorAtPath(PATH_TRANSFORMS),
      label: "Transforms",
      children: transformsChildren,
      defaultExpansionState: "expanded",
    },
    topics: {
      error: layerErrors.errorAtPath(PATH_TOPICS),
      label: "Topics",
      children: topicsChildren,
      defaultExpansionState: "expanded",
    },
  };
}

function mergeSetInto(output: Set<string>, input: ReadonlySet<string>) {
  for (const value of input) {
    output.add(value);
  }
}

function sorted<T>(array: ReadonlyArray<T>, compare: (a: T, b: T) => number): Array<T> {
  return array.slice().sort(compare);
}
