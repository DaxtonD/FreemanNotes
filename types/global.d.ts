declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const jsxDEV: any;
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [elemName: string]: any; }
}

declare const __APP_VERSION__: string;

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
