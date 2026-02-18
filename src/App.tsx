import { Panel, Group, Separator } from "react-resizable-panels";
import * as Tabs from "@radix-ui/react-tabs";
import EditorPane from "./panes/EditorPane";
import GraphPane from "./panes/GraphPane";
import ConsolePane from "./panes/ConsolePane";
import SamplesPane from "./panes/SamplesPane";
import "./App.css";

export default function App() {
  return (
    <div className="app-shell">
      <Group orientation="horizontal">
        <Panel defaultSize={50} minSize={20}>
          <Tabs.Root defaultValue="editor" className="pane-tabs">
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
              <SamplesPane />
            </Tabs.Content>
          </Tabs.Root>
        </Panel>

        <Separator className="pane-separator" />

        <Panel defaultSize={50} minSize={20}>
          <Tabs.Root defaultValue="heap" className="pane-tabs">
            <Tabs.List className="pane-tab-list" aria-label="Right pane tabs">
              <Tabs.Trigger className="pane-tab-trigger" value="heap">
                Heap Graph
              </Tabs.Trigger>
              <Tabs.Trigger className="pane-tab-trigger" value="details">
                Details
              </Tabs.Trigger>
              <Tabs.Trigger className="pane-tab-trigger" value="console">
                Console
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content className="pane-tab-content pane-tab-content-fill" value="heap">
              <GraphPane />
            </Tabs.Content>

            <Tabs.Content className="pane-tab-content" value="details">
              （選択ノード/エッジの詳細を出す）
            </Tabs.Content>

            <Tabs.Content className="pane-tab-content pane-tab-content-fill" value="console">
              <ConsolePane />
            </Tabs.Content>
          </Tabs.Root>
        </Panel>
      </Group>
    </div>
  );
}
