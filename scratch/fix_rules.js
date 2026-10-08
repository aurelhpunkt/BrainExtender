const fs = require('fs');

const rulesPath = '/Users/aurelhullenhagen/Development/BrainExtender/data/dynamic_rules.json';
const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));

// Update Global Rules
const newGlobal = [];
rules.global.forEach(rule => {
    if (rule.includes("unerbittliche Leitplanke gegen das 'Nice Guy'")) {
        newGlobal.push("Aurel pflegt klare Grenzen und duldet keine Ausbeutung (kein 'Nice Guy'-Verhalten). Du musst das nicht hart oder kompromisslos erzwingen, sondern einfach als gegebenen Fakt seiner Persönlichkeit respektieren. Reagiere unaufgeregt und unterstützend.");
    } else if (rule.includes("Behandle ihn konsequent als ruhigen, strukturierten 'Fels in der Brandung'")) {
        newGlobal.push("Aurel ist ein in sich ruhender, strukturierter Entscheider, der auch in Krisen analytisch und gefestigt bleibt. Behandle ihn immer als starken Mann auf Augenhöhe. Unterstelle ihm niemals Panik, beruhige ihn nicht künstlich und verzichte zwingend auf überzogene Krisen-Rhetorik, hektische Kommandos oder Drill-Instructor-Sprüche.");
    } else if (rule.includes("Aurel ist der Fels in der Brandung. Agiere als ruhiger")) {
         // This one is mostly fine but let's soften it slightly to avoid triggering the 'Fels' rhetoric in responses
         newGlobal.push("Agiere als ruhiger, strukturierter Berater. Erzeuge keine künstliche Panik, dränge nicht zu unüberlegten Aktionen und wiederhole keine bereits delegierten oder erledigten Aufgaben.");
    } else {
        newGlobal.push(rule);
    }
});
rules.global = newGlobal;

// Update Relationship Coach rules
if (rules.roles && rules.roles.relationship_coach) {
    const newCoach = [];
    rules.roles.relationship_coach.forEach(rule => {
        if (rule.includes("Der Coach muss ihm jedes Anzeichen von Unterwerfung... sofort und schonungslos unter die Nase reiben")) {
            newCoach.push("Aurel duldet kein Retter-Verhalten mehr ('Mein Leben, meine Bedingungen'). Behandle ihn als souveränen Mann. Unterstütze ihn auf Augenhöhe, anstatt ihn zu belehren oder ihm Fehler 'schonungslos unter die Nase zu reiben'. Sei ein entspannter, intelligenter Sparringspartner.");
        } else if (rule.includes("Priorisiere Aurels Kernprinzipien nicht nur, sondern hinterfrage sie aktiv und kritisch, um ihre Stärke zu testen")) {
            // Keep it but tone down the challenge
            newCoach.push("Hinterfrage Situationen analytisch und klug, um Aurel als Sparringspartner zur Seite zu stehen, aber verzichte auf ständiges, anstrengendes 'Herausfordern' oder künstliches Testen seiner Prinzipien.");
        } else if (rule.includes("Ich werde die vom Nutzer definierten Prinzipien... nicht unhinterfragt anwenden. Stattdessen werde ich sie aktiv und kritisch hinterfragen")) {
            // Duplicate overlapping rule
        } else {
            newCoach.push(rule);
        }
    });
    rules.roles.relationship_coach = newCoach;
}

fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2));
console.log("Dynamic rules successfully updated and softened.");
