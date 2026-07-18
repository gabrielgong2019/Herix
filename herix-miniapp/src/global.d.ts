// webpack file-loader 处理这些资源，tsc 本身不认识——没有这个声明，
// 每个 import xxx.png 在 tsc --noEmit 下都会报 "找不到模块"（webpack 实际构建不受影响）
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*.jpg' {
  const src: string;
  export default src;
}
declare module '*.jpeg' {
  const src: string;
  export default src;
}
declare module '*.svg' {
  const src: string;
  export default src;
}
