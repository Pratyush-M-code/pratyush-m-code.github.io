function reset() {
    type("home-quote", 1)
}

function easter_egg() {
    window.open('https://coppermind.net/wiki/Order_of_Willshapers', '_blank', 'noopener')
}
function stop() {
    run++
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let run = 0
async function type(id, randomness) {
    let element = document.getElementById(id)
    let text = element.dataset.full ||= element.textContent
    let char = [...text]
    let quote = ""
    let current = []
    const myRun = ++run
    for (let i = 0; i < text.length; i++) {
        if (myRun !== run) return
        let target = char[i]
        current.push(target)
        quote = current.join("")
        element.textContent = quote
        console.log(quote)
        if (target !== " ") {
            await pause(150);
        }
        else await pause(300);
    }
}


type("home-quote", 1)