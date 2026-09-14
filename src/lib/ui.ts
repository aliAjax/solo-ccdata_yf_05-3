// 展示层共用：边类型标签/颜色、许可证族配色、风险等级
import type {EdgeKind} from './graph';
import type {Copyleft} from './license';

export const KIND_LABEL: Record<EdgeKind, string> = {
  prod: '普通', dev: '开发', optional: '可选',
};
export const KIND_BADGE: Record<EdgeKind, string> = {
  prod: 'kind-prod', dev: 'kind-dev', optional: 'kind-opt',
};

export const FAMILY_COLORS: Record<string, string> = {
  MIT: '#2eab8e', ISC: '#45b39c',
  'BSD-2-Clause': '#5b93d6', 'BSD-3-Clause': '#5b7fd6',
  Apache: '#8a6fd6', 'Apache-1.1': '#8a6fd6',
  'MPL-2.0': '#d68a48', 'MPL-1.1': '#d68a48',
  EPL: '#c47ab0', 'EPL-1.0': '#c47ab0', 'EPL-2.0': '#c47ab0',
  LGPL: '#d69a3f', GPL: '#e06b52', AGPL: '#d64b6a',
  UNKNOWN: '#9aa8ad', UNLICENSED: '#7f8c92',
};

export function familyColor(family: string): string {
  if (FAMILY_COLORS[family]) return FAMILY_COLORS[family];
  if (family.startsWith('LGPL')) return FAMILY_COLORS.LGPL;
  if (family.startsWith('GPL')) return FAMILY_COLORS.GPL;
  if (family.startsWith('AGPL')) return FAMILY_COLORS.AGPL;
  if (family.startsWith('BSD')) return FAMILY_COLORS['BSD-3-Clause'];
  if (family.startsWith('EPL')) return FAMILY_COLORS.EPL;
  if (family.startsWith('Apache')) return FAMILY_COLORS.Apache;
  return '#8a979c';
}

export const COPYLEFT_LABEL: Record<Copyleft, string> = {
  none: '宽松', weak: '弱著佐权', strong: '强著佐权', network: '网络著佐权',
};

export const ISSUE_META: Record<string, {label: string; cls: string}> = {
  'duplicate-edge': {label: '重复边', cls: 'low'},
  'self-edge': {label: '自引用', cls: 'high'},
  cycle: {label: '环路', cls: 'high'},
  'missing-parent': {label: '缺失父节点', cls: 'medium'},
  'missing-target': {label: '缺失目标', cls: 'high'},
};

export function shorten(id: string, n = 34): string {
  return id.length > n ? id.slice(0, n - 1) + '…' : id;
}
