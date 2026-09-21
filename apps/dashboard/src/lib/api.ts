import { ApiClient, createApi } from '@autoservices/api-client'

declare const __API_URL__: string

export const apiClient = new ApiClient({ baseUrl: __API_URL__ })
export const api = createApi(apiClient)
export const API_URL = __API_URL__
