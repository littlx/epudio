// 应用入口
import { render } from "preact";
import { AppShell } from "./components/AppShell";
import "./styles/global.css";

render(<AppShell />, document.getElementById("app")!);
