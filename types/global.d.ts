declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const jsxDEV: any;
}

declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [elemName: string]: any; }
}
