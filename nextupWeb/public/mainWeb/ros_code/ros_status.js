// // ===================== HOMING DISPLAY =====================

// // Parent LED
// const robotLedHoming = document.getElementById('robot-led-homing');

// // Joint LEDs
// const homingLeds = Array.from({ length: 6 }, (_, i) =>
//     document.getElementById(`joint${i + 1}-led-homing`)
// );

// // Store latest joint states
// let latestJointStateMsg = null;

// // ===================== 5 Hz LOOP =====================
// setInterval(() => {

//     if (!latestJointStateMsg) return;

//     const jointPositions = {};
//     latestJointStateMsg.name.forEach((name, index) => {
//         jointPositions[name] = latestJointStateMsg.position[index];
//     });

//     const homingStatus = [];

//     for (let i = 1; i <= 6; i++) {
//         const jointName = `joint${i}`;
//         const position = jointPositions[jointName] ?? 0.0;

//         const isHomed = Math.abs(position).toFixed(3) === '0.000';
//         homingStatus.push(isHomed);

//         const led = homingLeds[i - 1];
//         if (led) {
//             led.classList.toggle('joint-indicator-true', isHomed);
//             led.classList.toggle('joint-indicator-false', !isHomed);
//         }
//     }

//     const allJointsHomed = homingStatus.every(Boolean);

//     robotLedHoming.classList.toggle('led-homing-true', allJointsHomed);
//     robotLedHoming.classList.toggle('led-homing-false', !allJointsHomed);

//     window.robotStatus = window.robotStatus || {};
//     window.robotStatus.homing = {
//         jointStatus: homingStatus,
//         allHomed: allJointsHomed
//     };

// }, 200);