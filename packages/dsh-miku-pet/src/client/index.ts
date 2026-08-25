// client 半侧入口(browser half):导出 apply/inject,由 shared/tsdown.client.ts
// 预设包装为 window.__ModuleLoader__.load({id, factory}) 闭包产物。
// react 走平台模块表(平台种子),不得值导入其它 @deepseek-ai/* 包。
import { createElement, useEffect, useRef, useState } from 'react'
import { jsx } from 'react/jsx-runtime'
import type { ReactNode } from 'react'
import { makePetUI } from './pet'
import { makePetConfigSection, NS, zh, en } from './settings'

/** 需要注入的服务:slots(页面插槽)与 locale(本地化)。 */
export const inject = ['slots', 'locale']

/** 浏览器半区:宠物 overlay + 设置页「桌宠配置」。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- DSH 注入的 ctx(locale/slots 等 service 无静态类型)
export function apply(ctx: any): void {
  // react/jsx-runtime 的 jsx 参数为 ElementType;组件工厂 rt.h 用宽松签名(类型层显式收窄)
  const h = jsx as unknown as (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => ReactNode
  // 宠物页面(多开:容器渲染多个 PetCard)
  const PetMulti = makePetUI({ h, useState, useEffect, useRef })
  // 设置页「桌宠配置」(大小/位置,保存即时生效)
  const PetConfigSection = makePetConfigSection({ h, useState, useEffect, t: ctx.locale.bind(NS) })

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'miku-pet: dictionaries')
  ctx.slots.inject('shell.overlay', function* () {
    yield ctx.slots.register({ name: 'shell.overlay', id: 'miku-pet', order: 1000 }, () => createElement(PetMulti, {}))
  })
  ctx.slots.inject('settings.section', function* () {
    yield ctx.slots.register(
      { name: 'settings.section', id: 'miku-pet-config', order: 30, label: () => ctx.locale.bind(NS)('nav'), inject: () => ({ t: ctx.locale.bind(NS) }) },
      PetConfigSection,
    )
  })
}
