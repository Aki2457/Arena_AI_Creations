const button = document.getElementById("click-me");
const counter = document.getElementById("counter");
let count = 0;

button.addEventListener("click", () => {
  count += 1;
  counter.textContent = `You clicked ${count} time${count === 1 ? "" : "s"}.`;
});
