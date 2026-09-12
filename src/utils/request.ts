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
    // 关键：非 2xx 响应必须透传后端的响应体，否则调用方只能拿到 axios 生成的
    // 通用文案（如 "Request failed with status code 503"），无法区分具体原因。
    //
    // 典型场景：存储未配置时后端返回 503 + data.error = "STORAGE_CONFIG_ERROR"，
    // 前端需要据此把用户引导到初始化向导；若丢掉 data，所有 503 都长得一样。
    const body = error.response?.data
    return {
      code: axios.isCancel(error) ? -1 : error.response?.status,
      // 优先用后端给出的可读消息，取不到才回退 axios 的通用文案
      message:
        (typeof body?.message === "string" && body.message) || error.message,
      // 透传业务数据（如 { error: "STORAGE_CONFIG_ERROR", configError }）
      data: body?.data,
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
