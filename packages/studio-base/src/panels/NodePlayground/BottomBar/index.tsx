// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/
//
// This file incorporates work covered by the following copyright and
// permission notice:
//
//   Copyright 2019-2021 Cruise LLC
//
//   This source code is licensed under the Apache License, Version 2.0,
//   found at http://www.apache.org/licenses/LICENSE-2.0
//   You may not use this file except in compliance with the License.

import {
  Badge,
  Box,
  Button,
  Paper,
  Stack,
  Tab,
  Tabs,
  styled as muiStyled,
  Divider,
} from "@mui/material";
import { useState, useRef, useEffect, ReactElement } from "react";

import { useUserNodeState } from "@foxglove/studio-base/context/UserNodeStateContext";
import DiagnosticsSection from "@foxglove/studio-base/panels/NodePlayground/BottomBar/DiagnosticsSection";
import LogsSection from "@foxglove/studio-base/panels/NodePlayground/BottomBar/LogsSection";
import { Diagnostic, UserNodeLog } from "@foxglove/studio-base/players/UserNodePlayer/types";

type Props = {
  nodeId?: string;
  isSaved: boolean;
  save: () => void;
  diagnostics: readonly Diagnostic[];
  logs: readonly UserNodeLog[];
};

type BottomBarModes = "logs" | "diagnostics" | "closed";

const TAB_HEIGHT = 36;

const StyledTab = muiStyled(Tab)(({ theme }) => ({
  minHeight: TAB_HEIGHT,
  minWidth: "auto",
  padding: theme.spacing(1.25, 1.5),
  textTransform: "uppercase",
  letterSpacing: "0.0125em",
  color: theme.palette.text.secondary,

  "&.Mui-selected": {
    color: theme.palette.text.primary,
  },
}));

const StyledTabs = muiStyled(Tabs)({
  minHeight: TAB_HEIGHT,
  position: "relative",
  bottom: -1,
});

const StyledBadge = muiStyled(Badge)(({ theme }) => ({
  alignItems: "center",

  ".MuiBadge-badge": {
    marginLeft: theme.spacing(1),
    position: "relative",
    transform: "none",

    "&.MuiBadge-invisible": {
      display: "none",
    },
  },
}));

const BottomBar = ({ nodeId, isSaved, save, diagnostics, logs }: Props): ReactElement => {
  const [bottomBarDisplay, setBottomBarDisplay] = useState<BottomBarModes>("closed");
  const [autoScroll, setAutoScroll] = useState(true);

  const { clearUserNodeLogs } = useUserNodeState();
  const scrollContainer = useRef<HTMLDivElement>(ReactNull);

  const handleChange = (_event: React.SyntheticEvent, value: BottomBarModes) => {
    setBottomBarDisplay(value);
  };

  const handleClick = (value: BottomBarModes) => {
    if (bottomBarDisplay === value) {
      setBottomBarDisplay("closed");
    }
  };

  useEffect(() => {
    if (autoScroll) {
      if (scrollContainer.current) {
        scrollContainer.current.scrollTop = scrollContainer.current.scrollHeight;
      }
    }
  }, [autoScroll, logs]);

  return (
    <>
      <Paper elevation={0}>
        <Divider />
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          gap={1}
          paddingRight={1}
        >
          <StyledTabs
            textColor="inherit"
            value={bottomBarDisplay !== "closed" ? bottomBarDisplay : false}
            onChange={handleChange}
          >
            <StyledTab
              label={
                <StyledBadge
                  color="error"
                  badgeContent={diagnostics.length}
                  invisible={diagnostics.length === 0}
                >
                  Problems
                </StyledBadge>
              }
              value="diagnostics"
              data-test="np-errors"
              onClick={() => handleClick("diagnostics")}
            />
            <StyledTab
              label={
                <StyledBadge color="error" badgeContent={logs.length} invisible={logs.length === 0}>
                  Logs
                </StyledBadge>
              }
              value="logs"
              data-test="np-logs"
              onClick={() => handleClick("logs")}
            />
          </StyledTabs>
          <Button
            size="small"
            color="primary"
            variant="contained"
            disabled={isSaved}
            title={"Ctrl/Cmd + S"}
            onClick={() => {
              if (nodeId != undefined) {
                save();
                clearUserNodeLogs(nodeId);
              }
            }}
          >
            {isSaved ? "Saved" : "Save"}
          </Button>
        </Stack>
        <Divider />
      </Paper>
      <Stack flex="auto" bgcolor="background.paper" position="relative">
        <Box
          ref={scrollContainer}
          onScroll={({ currentTarget }) => {
            const scrolledUp =
              currentTarget.scrollHeight - currentTarget.scrollTop > currentTarget.clientHeight;
            if (scrolledUp && autoScroll) {
              setAutoScroll(false);
            } else if (!scrolledUp && !autoScroll) {
              setAutoScroll(true);
            }
          }}
          style={{
            overflowY: bottomBarDisplay !== "closed" ? "scroll" : "auto",
            height: bottomBarDisplay !== "closed" ? 150 : 0,
            color: "text.secondary",
          }}
        >
          {bottomBarDisplay === "diagnostics" && <DiagnosticsSection diagnostics={diagnostics} />}
          {bottomBarDisplay === "logs" && (
            <LogsSection nodeId={nodeId} logs={logs} clearLogs={clearUserNodeLogs} />
          )}
        </Box>
      </Stack>
    </>
  );
};

export default BottomBar;
