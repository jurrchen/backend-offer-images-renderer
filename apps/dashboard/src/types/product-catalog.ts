// Types for Fourthwall Product Catalog API v2

export interface CatalogProduct {
  id: string
  name: string
  slug: string
  brand: {
    model: string
  }
  productionMethod: string
  customizationType: string
  variants: Array<{
    color: {
      name: string
      swatch: string
    }
    photoUrl?: string
  }>
}

export interface CatalogPage {
  page: number
  size: number
  totalElements: number
  totalPages: number
  products: CatalogProduct[]
}

export interface ColorVariant {
  color: {
    name: string
    swatch: string
  }
  status: string
  active: boolean
}

export interface ProductDetail {
  id: string
  name: string
  slug: string
  brand: {
    model: string
  }
  productionMethod: string
  customizationType: string
  colorVariants: ColorVariant[]
}

export interface GeneratorRegion {
  id: string
  name: string
}

export const PRODUCTION_METHODS = [
  'DTG',
  'SUBLIMATION',
  'EMBROIDERY',
  'UV',
  'ALL_OVER_PRINT',
  'PRINTED',
  'KNITTED',
  'CUT_SEW',
  'ENGRAVED',
  'HOLO_STICKER',
] as const

export type ProductionMethod = (typeof PRODUCTION_METHODS)[number]
