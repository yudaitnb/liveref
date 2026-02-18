import { Panel, Group, Separator } from "react-resizable-panels";
import * as Tabs from "@radix-ui/react-tabs";
import EditorPane from "./panes/EditorPane";
import GraphPane from "./panes/GraphPane";
import ConsolePane from "./panes/ConsolePane";

export default function App() {
  return (
    <div style={{ height: "100vh" }}>
      <Group orientation="horizontal">
        <Panel defaultSize={50} minSize={20}>
          <Tabs.Root defaultValue="editor" style={{ height: "100%" }}>
            <Tabs.List style={{ display: "flex", gap: 8, padding: 8 }}>
              <Tabs.Trigger value="editor">Editor</Tabs.Trigger>
              <Tabs.Trigger value="samples">Samples</Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="editor" style={{ height: "calc(100% - 40px)" }}>
              <EditorPane />
            </Tabs.Content>

            <Tabs.Content value="samples" style={{ padding: 12 }}>
              （あとでサンプル選択UIを置く）
            </Tabs.Content>
          </Tabs.Root>
        </Panel>

        <Separator style={{ width: 6, cursor: "col-resize" }} />

        <Panel defaultSize={50} minSize={20}>
          <Tabs.Root defaultValue="heap" style={{ height: "100%" }}>
            <Tabs.List style={{ display: "flex", gap: 8, padding: 8 }}>
              <Tabs.Trigger value="heap">Heap Graph</Tabs.Trigger>
              <Tabs.Trigger value="details">Details</Tabs.Trigger>
              <Tabs.Trigger value="console">Console</Tabs.Trigger> 
            </Tabs.List>

            <Tabs.Content value="heap" style={{ height: "calc(100% - 40px)" }}>
              <GraphPane />
            </Tabs.Content>

            <Tabs.Content value="details" style={{ padding: 12 }}>
              （選択ノード/エッジの詳細を出す）
            </Tabs.Content>

            <Tabs.Content value="console" style={{ height: "calc(100% - 40px)" }}>
              <ConsolePane />
            </Tabs.Content>
          </Tabs.Root>
        </Panel>
      </Group>
    </div>
  );
}
