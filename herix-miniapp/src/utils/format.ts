/** 千分位格式化（不依赖 toLocaleString，规避小程序 JS 引擎差异）。
 *  全局唯一实现——此前在 5 个页面各复制了一份。 */
export const fmt = (n: any): string => {
  const v = Math.round(Math.abs(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};
