// Branched from https://github.com/huggingface/gsplat.js/blob/d6df8ec0b8ac3683438cb99fec308e56ca7b14a9/src/controls/OrbitControls.ts#L6
// as there's too little control to spin the camera ourselves in their version.
import * as SPLAT from "https://cdn.jsdelivr.net/npm/gsplat@latest";

const Matrix3 = SPLAT.Matrix3;
const Quaternion = SPLAT.Quaternion;
const Vector3 = SPLAT.Vector3;

class OrbitControls {
    minAngle = -90
    maxAngle = 90
    minZoom = 0.1
    maxZoom = 30
    orbitSpeed = 1
    horizontalOrbitSpeed = 1
    verticalOrbitSpeed = 0.4
    dominantAxisOrbit = true
    dominantAxisRatio = 1.2
    orbitDeadzone = 1.25
    panSpeed = 1
    zoomSpeed = 1
    dampening = 0.12
    keyMoveSpeed = 0.008
    keyRotateSpeed = 0.004
    maxPanDistance = undefined

    constructor(
        camera,
        canvas,
        alpha = 0.5,
        beta = 0.5,
        radius = 5,
        enableKeyboardControls = true,
        inputTarget = new Vector3(),
        inputUp = new Vector3(0, 0, 1),
        inputRoll = 0
    ) {
        const zUp = Math.abs(inputUp.x) < 1e-6 && Math.abs(inputUp.y) < 1e-6 && inputUp.z > 0.0
        let target = inputTarget.clone()

        let desiredTarget = target.clone()
        let desiredAlpha = alpha
        let desiredBeta = beta
        let desiredRadius = radius

        let dragging = false
        let panning = false
        let lastDist = 0
        let lastX = 0
        let lastY = 0

        const keys = {}
        const setKeyState = (code, pressed) => {
            keys[code] = pressed
            if (code === "ArrowUp") keys["KeyW"] = pressed
            if (code === "ArrowDown") keys["KeyS"] = pressed
            if (code === "ArrowLeft") keys["KeyA"] = pressed
            if (code === "ArrowRight") keys["KeyD"] = pressed
        }

        let isUpdatingCamera = false

        const zUpRotation = direction => {
            let forward = direction.normalize()
            const upHint = inputUp.normalize()
            if (Math.abs(forward.dot(upHint)) > 0.999) {
                forward = new Vector3(forward.x + 1e-4, forward.y, forward.z).normalize()
            }
            const right = upHint.cross(forward).normalize()
            const correctedUp = forward.cross(right).normalize()
            return Quaternion.FromMatrix3(new Matrix3(
                right.x, correctedUp.x, forward.x,
                right.y, correctedUp.y, forward.y,
                right.z, correctedUp.z, forward.z,
            ))
        }

        const onCameraChange = () => {
            if (isUpdatingCamera) return

            const eulerRotation = camera.rotation.toEuler()
            desiredAlpha = -eulerRotation.y
            desiredBeta = -eulerRotation.x

            let x, y, z
            if (zUp) {
                x =
                    camera.position.x -
                    desiredRadius * Math.sin(desiredAlpha) * Math.cos(desiredBeta)
                y =
                    camera.position.y -
                    desiredRadius * Math.cos(desiredAlpha) * Math.cos(desiredBeta)
                z = camera.position.z - desiredRadius * Math.sin(desiredBeta)
            } else {
                x =
                    camera.position.x -
                    desiredRadius * Math.sin(desiredAlpha) * Math.cos(desiredBeta)
                y = camera.position.y + desiredRadius * Math.sin(desiredBeta)
                z =
                    camera.position.z +
                    desiredRadius * Math.cos(desiredAlpha) * Math.cos(desiredBeta)
            }

            desiredTarget = new Vector3(x, y, z)
        }

        camera.addEventListener("objectChanged", onCameraChange)

        this.setCameraTarget = newTarget => {
            const dx = newTarget.x - camera.position.x
            const dy = newTarget.y - camera.position.y
            const dz = newTarget.z - camera.position.z
            desiredRadius = Math.sqrt(dx * dx + dy * dy + dz * dz)
            if (zUp) {
                desiredBeta = Math.atan2(-dz, Math.sqrt(dx * dx + dy * dy))
                desiredAlpha = Math.atan2(-dx, -dy)
            } else {
                desiredBeta = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
                desiredAlpha = -Math.atan2(dx, dz)
            }
            desiredTarget = new Vector3(newTarget.x, newTarget.y, newTarget.z)
        }

        this.getPose = () => {
            return {
                alpha: desiredAlpha,
                beta: desiredBeta,
                radius: desiredRadius,
                target: {
                    x: desiredTarget.x,
                    y: desiredTarget.y,
                    z: desiredTarget.z,
                },
            }
        }

        this.setPose = pose => {
            if (!pose) return
            if (typeof pose.alpha === "number") desiredAlpha = pose.alpha
            if (typeof pose.beta === "number") desiredBeta = pose.beta
            if (typeof pose.radius === "number") {
                desiredRadius = Math.min(
                    Math.max(pose.radius, this.minZoom),
                    this.maxZoom
                )
            }
            if (pose.target) {
                const targetValue = Array.isArray(pose.target)
                    ? { x: pose.target[0], y: pose.target[1], z: pose.target[2] }
                    : pose.target
                desiredTarget = new Vector3(
                    Number(targetValue.x) || 0,
                    Number(targetValue.y) || 0,
                    Number(targetValue.z) || 0,
                )
            }
            alpha = desiredAlpha
            beta = desiredBeta
            radius = desiredRadius
            target = desiredTarget.clone()
            this.update()
        }

        // Add in a method to manually rotate the camera in our branch.
        this.rotateCameraAngle = (deltaAlpha, deltaBeta) => {
            desiredAlpha += deltaAlpha;
            deltaBeta += deltaBeta;
        }

        const computeZoomNorm = () => {
            return (
                0.1 +
                (0.9 * (desiredRadius - this.minZoom)) / (this.maxZoom - this.minZoom)
            )
        }

        const screenToOrbitDelta = (dx, dy) => {
            // Camera roll rotates the rendered image, so rotate pointer deltas back
            // before mapping horizontal drag to yaw and vertical drag to pitch.
            const c = Math.cos(-inputRoll)
            const s = Math.sin(-inputRoll)
            let orbitDx = c * dx - s * dy
            let orbitDy = s * dx + c * dy
            if (Math.abs(orbitDx) < this.orbitDeadzone) orbitDx = 0
            if (Math.abs(orbitDy) < this.orbitDeadzone) orbitDy = 0
            if (this.dominantAxisOrbit) {
                const absDx = Math.abs(orbitDx)
                const absDy = Math.abs(orbitDy)
                if (absDx > absDy * this.dominantAxisRatio) orbitDy = 0
                if (absDy > absDx * this.dominantAxisRatio) orbitDx = 0
            }
            return {
                dx: orbitDx * this.horizontalOrbitSpeed,
                dy: orbitDy * this.verticalOrbitSpeed,
            }
        }

        this.setKeyState = setKeyState

        const onKeyDown = e => setKeyState(e.code, true)

        const onKeyUp = e => setKeyState(e.code, false)

        const onMouseDown = e => {
            preventDefault(e)

            dragging = true
            panning = e.button === 2
            lastX = e.clientX
            lastY = e.clientY
            window.addEventListener("mouseup", onMouseUp)
        }

        const onMouseUp = e => {
            preventDefault(e)

            dragging = false
            panning = false
            window.removeEventListener("mouseup", onMouseUp)
        }

        const onMouseMove = e => {
            preventDefault(e)

            if (!dragging || !camera) return

            const dx = e.clientX - lastX
            const dy = e.clientY - lastY

            if (panning) {
                const zoomNorm = computeZoomNorm()
                const panX = -dx * this.panSpeed * 0.01 * zoomNorm
                const panY = -dy * this.panSpeed * 0.01 * zoomNorm
                const R = Matrix3.RotationFromQuaternion(camera.rotation).buffer
                const right = new Vector3(R[0], R[3], R[6])
                const up = new Vector3(R[1], R[4], R[7])
                desiredTarget = desiredTarget.add(right.multiply(panX))
                desiredTarget = desiredTarget.add(up.multiply(panY))

                if (this.maxPanDistance !== undefined) {
                    if (desiredTarget.magnitude() > 0.0) {
                        const mag = Math.min(desiredTarget.magnitude(), this.maxPanDistance)
                        desiredTarget = desiredTarget.normalize().multiply(mag)
                    }
                }
            } else {
                const orbitDelta = screenToOrbitDelta(dx, dy)
                desiredAlpha -= orbitDelta.dx * this.orbitSpeed * 0.003
                desiredBeta += orbitDelta.dy * this.orbitSpeed * 0.003
                desiredBeta = Math.min(
                    Math.max(desiredBeta, (this.minAngle * Math.PI) / 180),
                    (this.maxAngle * Math.PI) / 180
                )
            }

            lastX = e.clientX
            lastY = e.clientY
        }

        const onWheel = e => {
            preventDefault(e)

            const zoomNorm = computeZoomNorm()
            desiredRadius += e.deltaY * this.zoomSpeed * 0.025 * zoomNorm
            desiredRadius = Math.min(
                Math.max(desiredRadius, this.minZoom),
                this.maxZoom
            )
        }

        const onTouchStart = e => {
            preventDefault(e)

            if (e.touches.length === 1) {
                dragging = true
                panning = false
                lastX = e.touches[0].clientX
                lastY = e.touches[0].clientY
                lastDist = 0
            } else if (e.touches.length === 2) {
                dragging = true
                panning = true
                lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2
                lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2
                const distX = e.touches[0].clientX - e.touches[1].clientX
                const distY = e.touches[0].clientY - e.touches[1].clientY
                lastDist = Math.sqrt(distX * distX + distY * distY)
            }
        }

        const onTouchEnd = e => {
            preventDefault(e)

            dragging = false
            panning = false
        }

        const onTouchMove = e => {
            preventDefault(e)

            if (!dragging || !camera) return

            if (panning) {
                const zoomNorm = computeZoomNorm()

                const distX = e.touches[0].clientX - e.touches[1].clientX
                const distY = e.touches[0].clientY - e.touches[1].clientY
                const dist = Math.sqrt(distX * distX + distY * distY)
                const delta = lastDist - dist
                desiredRadius += delta * this.zoomSpeed * 0.1 * zoomNorm
                desiredRadius = Math.min(
                    Math.max(desiredRadius, this.minZoom),
                    this.maxZoom
                )
                lastDist = dist

                const touchX = (e.touches[0].clientX + e.touches[1].clientX) / 2
                const touchY = (e.touches[0].clientY + e.touches[1].clientY) / 2
                const dx = touchX - lastX
                const dy = touchY - lastY
                const R = Matrix3.RotationFromQuaternion(camera.rotation).buffer
                const right = new Vector3(R[0], R[3], R[6])
                const up = new Vector3(R[1], R[4], R[7])
                desiredTarget = desiredTarget.add(
                    right.multiply(-dx * this.panSpeed * 0.025 * zoomNorm)
                )
                desiredTarget = desiredTarget.add(
                    up.multiply(-dy * this.panSpeed * 0.025 * zoomNorm)
                )
                lastX = touchX
                lastY = touchY
            } else {
                const dx = e.touches[0].clientX - lastX
                const dy = e.touches[0].clientY - lastY

                const orbitDelta = screenToOrbitDelta(dx, dy)
                desiredAlpha -= orbitDelta.dx * this.orbitSpeed * 0.003
                desiredBeta += orbitDelta.dy * this.orbitSpeed * 0.003
                desiredBeta = Math.min(
                    Math.max(desiredBeta, (this.minAngle * Math.PI) / 180),
                    (this.maxAngle * Math.PI) / 180
                )

                lastX = e.touches[0].clientX
                lastY = e.touches[0].clientY
            }
        }

        const lerp = (a, b, t) => {
            return (1 - t) * a + t * b
        }

        this.update = () => {
            isUpdatingCamera = true

            alpha = lerp(alpha, desiredAlpha, this.dampening)
            beta = lerp(beta, desiredBeta, this.dampening)
            radius = lerp(radius, desiredRadius, this.dampening)
            target = target.lerp(desiredTarget, this.dampening)

            let x, y, z
            if (zUp) {
                x = target.x + radius * Math.sin(alpha) * Math.cos(beta)
                y = target.y + radius * Math.cos(alpha) * Math.cos(beta)
                z = target.z + radius * Math.sin(beta)
            } else {
                x = target.x + radius * Math.sin(alpha) * Math.cos(beta)
                y = target.y - radius * Math.sin(beta)
                z = target.z - radius * Math.cos(alpha) * Math.cos(beta)
            }
            camera.position = new Vector3(x, y, z)

            const direction = target.subtract(camera.position).normalize()
            if (zUp) {
                camera.rotation = zUpRotation(direction)
            } else {
                const rx = Math.asin(-direction.y)
                const ry = Math.atan2(direction.x, direction.z)
                camera.rotation = Quaternion.FromEuler(new Vector3(rx, ry, inputRoll))
            }

            const moveSpeed = this.keyMoveSpeed
            const rotateSpeed = this.keyRotateSpeed

            const R = Matrix3.RotationFromQuaternion(camera.rotation).buffer
            const forward = new Vector3(-R[2], -R[5], -R[8])
            const right = new Vector3(R[0], R[3], R[6])

            if (keys["KeyS"])
                desiredTarget = desiredTarget.add(forward.multiply(moveSpeed))
            if (keys["KeyW"])
                desiredTarget = desiredTarget.subtract(forward.multiply(moveSpeed))
            if (keys["KeyA"])
                desiredTarget = desiredTarget.subtract(right.multiply(moveSpeed))
            if (keys["KeyD"])
                desiredTarget = desiredTarget.add(right.multiply(moveSpeed))

            // Add rotation with 'e' and 'q' for horizontal rotation
            if (keys["KeyE"]) desiredAlpha += rotateSpeed
            if (keys["KeyQ"]) desiredAlpha -= rotateSpeed

            // Add rotation with 'r' and 'f' for vertical rotation
            if (keys["KeyR"]) desiredBeta += rotateSpeed
            if (keys["KeyF"]) desiredBeta -= rotateSpeed

            isUpdatingCamera = false
        }

        const preventDefault = e => {
            e.preventDefault()
            e.stopPropagation()
        }

        this.dispose = () => {
            canvas.removeEventListener("dragenter", preventDefault)
            canvas.removeEventListener("dragover", preventDefault)
            canvas.removeEventListener("dragleave", preventDefault)
            canvas.removeEventListener("contextmenu", preventDefault)

            canvas.removeEventListener("mousedown", onMouseDown)
            canvas.removeEventListener("mousemove", onMouseMove)
            canvas.removeEventListener("wheel", onWheel)

            canvas.removeEventListener("touchstart", onTouchStart)
            canvas.removeEventListener("touchend", onTouchEnd)
            canvas.removeEventListener("touchmove", onTouchMove)

            if (enableKeyboardControls) {
                window.removeEventListener("keydown", onKeyDown)
                window.removeEventListener("keyup", onKeyUp)
            }
        }

        if (enableKeyboardControls) {
            window.addEventListener("keydown", onKeyDown)
            window.addEventListener("keyup", onKeyUp)
        }

        canvas.addEventListener("dragenter", preventDefault)
        canvas.addEventListener("dragover", preventDefault)
        canvas.addEventListener("dragleave", preventDefault)
        canvas.addEventListener("contextmenu", preventDefault)

        canvas.addEventListener("mousedown", onMouseDown)
        canvas.addEventListener("mousemove", onMouseMove)
        canvas.addEventListener("wheel", onWheel)

        canvas.addEventListener("touchstart", onTouchStart)
        canvas.addEventListener("touchend", onTouchEnd)
        canvas.addEventListener("touchmove", onTouchMove)

        this.update()
    }
}

export { OrbitControls }
