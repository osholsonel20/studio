// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Immutable } from "immer";
import { chain } from "lodash";

import { Topic } from "@foxglove/studio";
import { SettingsTreeRoots } from "@foxglove/studio-base/components/SettingsTreeEditor/types";

import { Config } from "./types";

export function buildSettingsTree({
  config,
  imageTopics,
  markerTopics,
  enabledMarkerTopics,
  relatedMarkerTopics,
}: {
  config: Immutable<Config>;
  imageTopics: readonly Topic[];
  markerTopics: readonly string[];
  enabledMarkerTopics: readonly string[];
  relatedMarkerTopics: readonly string[];
}): SettingsTreeRoots {
  const markerFields = chain(markerTopics)
    .sort()
    .partition((topic) => relatedMarkerTopics.includes(topic))
    .thru((topics) => topics.flat())
    .map((topic) => [topic, { label: topic, visible: enabledMarkerTopics.includes(topic) }])
    .fromPairs()
    .value();

  return {
    general: {
      label: "General",
      fields: {
        cameraTopic: {
          label: "Camera Topic",
          input: "select",
          value: config.cameraTopic,
          options: imageTopics.map((topic) => ({ label: topic.name, value: topic.name })),
        },
        transformMarkers: {
          input: "boolean",
          label: "Synchronize Markers",
          value: config.transformMarkers,
          help: config.transformMarkers
            ? "Markers are being transformed by Foxglove Studio based on the camera model. Click to turn it off."
            : `Markers can be transformed by Foxglove Studio based on the camera model. Click to turn it on.`,
        },
        smooth: {
          input: "boolean",
          label: "Bilinear Smoothing",
          value: config.smooth ?? false,
        },
        flipHorizontal: {
          input: "boolean",
          label: "Flip Horizontal",
          value: config.flipHorizontal ?? false,
        },
        flipVertical: {
          input: "boolean",
          label: "Flip Vertical",
          value: config.flipVertical ?? false,
        },
        rotation: {
          input: "select",
          label: "Rotation",
          value: config.rotation ?? 0,
          options: [
            { label: "0°", value: 0 },
            { label: "90°", value: 90 },
            { label: "180°", value: 180 },
            { label: "270°", value: 270 },
          ],
        },
        minValue: {
          input: "number",
          label: "Minimum Value (depth images)",
          placeholder: "0",
          value: config.minValue,
        },
        maxValue: {
          input: "number",
          label: "Maximum Value (depth images)",
          placeholder: "10000",
          value: config.maxValue,
        },
      },
    },
    markers: {
      label: "Markers",
      children: markerFields,
    },
  };
}
