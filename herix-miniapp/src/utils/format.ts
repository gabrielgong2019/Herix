/** 千分位格式化（不依赖 toLocaleString，规避小程序 JS 引擎差异）。
 *  全局唯一实现——此前在 5 个页面各复制了一份。 */
export const fmt = (n: any): string => {
  const v = Math.round(Math.abs(Number(n) || 0));
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
};

/** 时间本地化显示：库里两种存法——Node 写的 ISO UTC(带T/Z)、PG 列默认值
 *  写的无时区裸串(生产 ECS 固定+08)。都转成设备本地时间 'YYYY-MM-DD HH:mm'；
 *  纯日期(长度<=10)原样返回。只显日期时对返回值 .slice(0,10)。 */
export const fmtLocal = (s: any): string => {
  if (!s) return '';
  const str = String(s);
  if (str.length <= 10) return str;
  const d = str.indexOf('T') >= 0 ? new Date(str) : new Date(str.replace(' ', 'T') + '+08:00');
  if (isNaN(d.getTime())) return str.slice(0, 16).replace('T', ' ');
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
