// 啟動 Firebase 模擬器前，關閉殘留的模擬器程序（Windows 上 emulators:exec 偶爾無法完整結束 Java 程序）
import { execSync } from 'node:child_process'

const PORTS = [8080, 9099, 9150, 4400, 4500]

function pidsOnPorts() {
  const pids = new Set()
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' })
      for (const line of out.split(/\r?\n/)) {
        const m = line.trim().split(/\s+/)
        if (m.length >= 5 && m[3] === 'LISTENING') {
          const port = Number(m[1].split(':').pop())
          if (PORTS.includes(port)) pids.add(m[4])
        }
      }
    } else {
      const out = execSync(`lsof -ti ${PORTS.map((p) => `tcp:${p}`).join(' -i ')} -i tcp:${PORTS[0]} || true`, { encoding: 'utf8' })
      for (const p of out.split(/\s+/).filter(Boolean)) pids.add(p)
    }
  } catch { /* 沒有結果 */ }
  return [...pids]
}

function commandLine(pid) {
  try {
    if (process.platform === 'win32') {
      return execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`, { encoding: 'utf8' })
    }
    return execSync(`ps -o command= -p ${pid}`, { encoding: 'utf8' })
  } catch { return '' }
}

for (const pid of pidsOnPorts()) {
  const cmd = commandLine(pid)
  // 只關閉 Firebase 模擬器，避免誤關其他程式
  if (!/firebase|firestore-emulator|cloud-firestore/i.test(cmd)) continue
  try {
    execSync(process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, { stdio: 'ignore' })
    console.log(`已關閉殘留的模擬器程序 ${pid}`)
  } catch { /* 已結束 */ }
}
