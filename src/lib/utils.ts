export function withQueryParams(url: string, params: Map<string, string>) {
  let urlWithQueryParams = url
  let count = 0
  for (let [key, value] of params) {
    if (count == 0) {
      urlWithQueryParams += `?${key}=${value}`
    } else {
      urlWithQueryParams += `&${key}=${value}`
    }
    count += 1
  }
  return urlWithQueryParams
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fetchWithRetries(url: string, options?: RequestInit, retries = 7, delay = 25): Promise<Response> {
  return fetch(url, options)
    .catch(async () => {
      if (retries > 0) {
        if (delay <= 0) {
          delay = 25
        } else {
          delay *= 2
        }
        logDebug(`Request failed, retrying in ${delay}ms, retry left ${retries}`)
        await sleep(delay)
        return fetchWithRetries(url, options, retries - 1, delay)
      }
    });
}

export function devMode() {
  return import.meta.env.DEV
}

export function logDebug(msg) {
  if (devMode()) {
    console.log(msg)
  }
}