import '../styles/global.css';
import type { JSX } from 'solid-js';

export default function Layout(props: { children?: JSX.Element }) {
  return <>{props.children}</>;
}
