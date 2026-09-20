const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function type(id,randomness){
    let element = document.getElementById(id)
    let text = element.textContent
    let char = [...text]
    let quote = ""
    let current = []
    for (let i = 0; i < text.length; i++){
        let target = char[i]
        current.push(target)
        quote = current.join("")
        element.textContent = quote
        console.log(quote)
        if(target !== " "){
            await pause(150);
        }
        else await pause(300);
    }
}

type("home-quote",1)