import axios from "axios"
import { api, log } from "."

const instance = axios.create({
  baseURL: api + "/api",
  // timeout: 5000
  headers: {
    "Content-Type": "application/json;charset=utf-8",
    // 'Authorization': localStorage.getItem("admin-token") || "",
  },
  withCredentials: false,
})

instance.interceptors.request.use(
  (config) => {
    // do something before request is sent
    return config
  },
  (error) => {
    // do something with request error
    console.log("Error: " + error.message) // for debug
    return Promise.reject(error)
  },
)

// response interceptor
instance.interceptors.response.use(
  (response) => {
    const resp = response.data
    log(resp)
    return resp
  },
  (error) => {
    // response error
    console.error(error) // for debug
    // notificationService.show({
    //   status: "danger",
    //   title: error.code,
    //   description: error.message,
    // });
    //
    // 服务端在非 2xx 时同样返回 { code, message, data } 结构（例如初始化
    // 失败会给出 data.reason 说明具体原因）。这里把响应体透传出来：
    //   - message 优先用服务端的文案，避免用户只看到 axios 的
    //     "Request failed with status code 500"；
    //   - data 保留给调用方展示结构化原因。
    // 网络错误/超时没有 response，退回 axios 的 message。
    const body = error.response?.data as
      { message?: string; data?: unknown } | undefined
    return {
      code: axios.isCancel(error) ? -1 : error.response?.status,
      message: body?.message || error.message,
      data: body?.data ?? null,
    }
  },
)

instance.defaults.headers.common["Authorization"] =
  localStorage.getItem("token") || ""

export const changeToken = (token?: string) => {
  instance.defaults.headers.common["Authorization"] = token ?? ""
  localStorage.setItem("token", token ?? "")
}

export { instance as r }
