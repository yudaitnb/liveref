import { Panel, Group, Separator } from "react-resizable-panels";
import * as Tabs from "@radix-ui/react-tabs";
import { useState } from "react";
import EditorPane from "./panes/EditorPane";
import GraphPane from "./panes/GraphPane";
import ConsolePane from "./panes/ConsolePane";
import SamplesPane from "./panes/SamplesPane";
import CallGraphPane from "./panes/CallGraphPane";
import "./App.css";

export default function App() {
  const [leftTab, setLeftTab] = useState("editor");
  const [rightTab, setRightTab] = useState("heap");

  return (
    <div className="app-shell">
      <Group orientation="horizontal">
        <Panel defaultSize={50} minSize={20}>
          <Tabs.Root value={leftTab} onValueChange={setLeftTab} className="pane-tabs">
            <Tabs.List className="pane-tab-list" aria-label="Left pane tabs">
              <Tabs.Trigger className="pane-tab-trigger" value="editor">
                Editor
              </Tabs.Trigger>
              <Tabs.Trigger className="pane-tab-trigger" value="samples">
                Samples
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content className="pane-tab-content pane-tab-content-fill" value="editor">
              <EditorPane />
            </Tabs.Content>

            <Tabs.Content className="pane-tab-content" value="samples">
              <SamplesPane onSampleSelected={() => setLeftTab("editor")} />
            </Tabs.Content>
          </Tabs.Root>
        </Panel>

        <Separator className="pane-separator" />

        <Panel defaultSize={50} minSize={20}>
          <Tabs.Root value={rightTab} onValueChange={setRightTab} className="pane-tabs">
            <Tabs.List className="pane-tab-list" aria-label="Right pane tabs">
              <Tabs.Trigger className="pane-tab-trigger" value="heap">
                Heap Graph
              </Tabs.Trigger>
              <Tabs.Trigger className="pane-tab-trigger" value="details">
                Call Graph
              </Tabs.Trigger>
              <Tabs.Trigger className="pane-tab-trigger" value="console">
                Console
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content className="pane-tab-content pane-tab-content-fill" value="heap" forceMount>
              <GraphPane />
            </Tabs.Content>

            <Tabs.Content className="pane-tab-content" value="details" forceMount>
              <CallGraphPane onJumpToHeap={() => setRightTab("heap")} />
            </Tabs.Content>

            <Tabs.Content className="pane-tab-content pane-tab-content-fill" value="console" forceMount>
              <ConsolePane />
            </Tabs.Content>
          </Tabs.Root>
        </Panel>
      </Group>
    </div>
  );
}
