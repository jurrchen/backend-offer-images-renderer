// XAST V4 node types — plain objects, no product-editor dependency

export interface XastRoot {
  type: 'root'
  children: XastNode[]
}

export interface XastInstruction {
  type: 'instruction'
  name: string
  value: string
}

export interface XastElement {
  type: 'element'
  name: string
  attributes: Record<string, string>
  children: XastNode[]
}

export interface XastText {
  type: 'text'
  value: string
}

export type XastNode = XastInstruction | XastElement | XastText

// Centering types

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface RegionDimensions {
  pixelsWidth: number
  pixelsHeight: number
}

export interface CenteringResult {
  assetId: string
  originalWidth: number
  originalHeight: number
  scaledWidth: number
  scaledHeight: number
  x: number
  y: number
  fitScale: number
}

export type ScaleMode = 'contain' | 'cover' | 'natural'

// CustomizationStateV4X types

export interface StateRecord {
  active: boolean
  value: unknown // XastRoot JSON
}

export interface StateItem {
  regionId: string
  records: StateRecord[]
}

export type CustomizationState = {
  version: '4'
  value: Record<string, StateItem[]>
}
