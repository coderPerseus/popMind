import svg from '../public/logo.svg?raw';

// popMind's logo, the intro's two strokes (made by the app's site-assets test), in the text's color.
export default function Logo(props: { size: number; class?: string }) {
  return (
    <span
      class={`logo ${props.class ?? ''}`}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
      aria-hidden="true"
      innerHTML={svg}
    />
  );
}
