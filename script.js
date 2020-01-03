'use strict';
/* 
TODO:

- bug with button size
- bug with autocomplete size
- comment out geo debug
- comment out contact card debug

- date of picture change

- status (in settings, and display it)
- contact
 - include more info
 - add to yours
- button to invoke web share api. Maybe in conjunction with expanding QR code? (Don't forget to guard with feature detect because not available on non-native pseudo-browsers or some desktop browsers. Devlop with Safari on osx, and must be on user action rather than, say, console. Ignores title property?)

- add to homescreen - prompt on ios
- is camera available in ios standalone? (workarounds might be to add to homescreen in a browser mode, and I read that "PWAs that need to open the camera, such as QR Code readers can only take snapshots")

- geo:
 - service workers
 - should not show you if "offline", but should allow service worker. (how does user control that?) Does that first require app to be on home page?
 - right now, we only get position and sort when you open app. When should we we update that?
 - computeNearby should limit those within accuracy, if that's less than some limit, otherwise some limit N.
 -  should we show yourself with the nearby, or only in settings, or what?

- message for word that does not complete
- dynamically adjust wordcloud weight
- clicking your own picture or (placeholder) status allows you to change it (instead of having to go through settings)
- speech synthesis so that you're not staring at phone. (Is it true that this requires headset to be connected? That's hard on demos.)
- transfer to another device (most alive one wins)
- setup cleanup
- mirror camera when aligning
- pending words: collect for voting; secret password to show upvoted words and approve them
- datalist for word choice, instead of select? (combines filtered list choices combined with keyboard?)
- demo apple pay
- demo sensors for orientation in space. (Might now be disabled by default, such that we have to tell people to enable settings => safari => motion & orientation access. See https://github.com/w3c/deviceorientation/issues/57#issuecomment-476373339)
- demo bose ar for orientation in space
- google analytics, with pipeline, events, errors
- rate this app
- lockout time (against re-voting)
- public figure of the day

TBD:
- Is there a way to make voting more anonymous by messing with the time at which it shows up - while still staying current enough?
*/

// For this prototype, instead of an application-specific server that gives you just the data you need (of the potential billion users),
// we just make sure that everyone has an in-memory copy of all the data. For that purpose we purpose, the prototype uses croquet.studio,
// whose job it is to keep that in-memory copf of the models in sync, replicated it among all the users (either immediately, or when they
// come online). This allows the prototype app to work without any application-specific server at all!

const Q = Croquet.Constants; // Shared among all participants, and part of the hashed definition to be replicated.

Q.APP_VERSION = "KnowMe 0.0.50"; // Rev'ing guarantees a fresh model (e.g., when view usage changes incompatibly during development).
Q.LOCAL_LOG = true;

// Just used in initializing the userverse. Change this constant, and you've fractured the userverse into old and new sets!
Q.INITIAL_WORD_LIST = `teacher mentor patron protector entertainer considerate courteous courageous adventurous
inventive philosophical persistent practical sensible logical rational
sincere ernest unassuming funny witty clever kind compassionate
empathetic sympathetic talented adaptable reliable diligent fair
impartial skilled exciting resourceful knowledgeable ambitious
passionate exuberant frank generous persuasive approachable friendly
gregarious wise`;


/*  Startup flow:
ensureUserModel: If our model is not in replicated UserverseModel, create replicated UserModel.
  UserModel needs a userId, which is only known locally, so this has to be checked in the view.
  If we do create a model, everyone needs to addUserView.
When a view is created (when starting our UserverseView, or in addUserView), if it is ours:
  If we are not setup, do so. 
    Model might have existed (to receive contact), but not been set up at that time.
    displayNearby when done
  If we don't have a current position, update model with position.
    Might be in parallel with setup.
updateDisplay happens for everyone as soon as they hear about it.
  That avatar might or might not be showing at the time, but update it regardless.
On updating model position (of anyone), displayNearby for UserverseView.
On return from interacting with someone, displayNearby.
displayNearby exits unless on main screen with our own initial, picture, and current position

 */

class WordCountModel extends Croquet.Model { // Maintains a map of word => count, used for Userverse overall, and each User.
    init(options) {
        super.init(options);
        this.words = new Map();
    }
    incrementWordCount(word, increment = 1) {
        const was = this.words.get(word) || 0;
        this.words.set(word, was + increment);
    }
    log(...args) {
        if (Q.LOCAL_LOG) return console.log(...args);
        this.publish(this.sessionId, 'log', args.join(' '));
    }
}

// Database of the users, and the data that is common to all users (available words). Could have multiples if we want to support factions.
class UserverseModel extends WordCountModel { 
    init(options) { // Initial data for this userverse, IFF there is no existing snapshot.
        this.log('init UserverseModel', options, this);
        super.init(options);

        // The Map of blessed/localizeable words to use count so that each can be ordered for autocomplete.
        this.words = new Map(Q.INITIAL_WORD_LIST.split(/\s+/).map(word => [word, 0]));

        this.users = new Map([ // Set up some universally available dead people, so that there's always someone to work with.
            {name: "Alan Turing", words: "curious logical resourceful knowledgeable persistent kind practical rational",
             position: [51.9977, 0.7407],
             photo: "alan-turing.jpg"},
            {name: "Oscar Wilde", words: "historian witty gregarious naturalist charming talented exuberant ernest adventurous",
             position: [48.860000, 2.396000],
             photo: "oscar-wilde.jpg"},
            {name: "Cleopatra", words: "persuasive ambitious patriotic resourceful adaptable knowledgeable passionate exciting courageous adventurous persistent witty skilled",
             position: [31.200000, 29.916667],
             photo: "cleopatra.jpg"},
            {name: "Eleanor Roosevelt", words: "kind compassionate spiritual resourceful persuasive knowledgeable courageous",
             position: [41.7695366,-73.938733],
             photo: "eleanor-roosevelt.jpg"}
        ].map(options => {
            const user = UserModel.create(options);
            return [user.userId, user];
        }));
        this.subscribe(this.sessionId, 'addUser', this.addUser);
    }
    findUser(userId) { // Answer existing UserModel, if any.
        return this.users.get(userId); // FIXME: use wellKnownModel mechanism.
    }
    addUser(userId) { // Create the model and the view
        this.log('addUser', userId, 'among', this.users);
        this.users.set(userId, UserModel.create({userId: userId})); // Other info will be updated for everyone by that user's setup.
        this.publish(this.sessionId, 'addUserView', userId);
    }
}

class UserModel extends WordCountModel { // Each user's data
    init(options) { // Initial setup IFF not already in snapshot.
        this.log('init UserModel', options, this);
        super.init(options);
        if (options.name) {
            this.initDeadPerson(options);  // Name at init time only happens with the sample users.
        } else {
            this.userId = options.userId;
        }
        this.subscribe(this.userId, 'rate', this.rate);
        this.subscribe(this.userId, 'contact', this.setContact);
        this.subscribe(this.userId, 'photo', this.setPhoto);
        this.subscribe(this.userId, 'threeWords', this.setThreeWords);
        this.subscribe(this.userId, 'setPosition', this.setPosition);
    }
    initDeadPerson({name, words, photo, position}) { // Set up as an always "online" person to play with.
        this.userId = name;
        this.setContact({name: name});
        this.setPhoto(photo);
        this.setPosition({position: position});
        words.split(/\s+/).reverse().forEach((word, index) => this.incrementWordCount(word, index + 1));
    }
    incrementWordCount(word, increment = 1) { // For this user, AND for the total popularity of all words in the userverse.
        super.incrementWordCount(word, increment);
        this.wellKnownModel('modelRoot').incrementWordCount(word, increment);
    }
    maybeUpdateWord(newWord, key, weight = 1) { // Update user's own suggestions and their counts, answering true IFF actually a change.
        const oldWord = this[key];
        if (newWord === oldWord) return false;
        if (oldWord) this.incrementWordCount(oldWord, 0 - weight);
        if (newWord) this.incrementWordCount(newWord, weight);
        this[key] = newWord;
        return true;
    }

    // These messages handle updates to the model, and tell views to update as necessary.
    rate({word, increment = 1}) {
        this.incrementWordCount(word, increment);
    }
    setPhoto(url) {
        this.photo = url;
        // FIXME set date
        // FIXME: decide where to check against changes. here or view?
        this.publish(this.userId, 'updateDisplay');
    }
    setPosition({position, accuracy}) {
        this.log('setPosition', position, accuracy, 'for', this.userId);
        this.position = position;
        this.accuracy = accuracy;
        if (accuracy) this.publish(this.sessionId, 'displayNearby');
    }
    setContact({name}) {
        this.contactName = name;
        this.initial = name[0];
        // FIXME more
        this.publish(this.userId, 'updateDisplay');
    }
    setThreeWords([word1, word2, word3]) {
        if ([ // Don't short-circuit with ||. Update each.
            this.maybeUpdateWord(word1, 'word1', 2),
            this.maybeUpdateWord(word2, 'word2', 1),
            this.maybeUpdateWord(word3, 'word3', 1)
        ].some(bool => bool)) {
            this.publish(this.userId, 'updateDisplay');
        }
    }
}

class UserverseView extends Croquet.View { // Local version for display.
    constructor(model) { // Set up subscriptions and DOM event handlers.
        super(model);
        this.model = model;
        this.users = new Map(Array.from(this.model.users.values()).map(userModel => [userModel.userId, new UserView(userModel)]));
        this.subscribe(this.sessionId, "view-join", this.ensureLocalModel);
        this.subscribe(this.sessionId, 'addUserView', this.addUserView);
        this.subscribe(this.sessionId, 'displayNearby', this.displayNearby);
        this.subscribe(this.sessionId, 'log', this.logMessage);
        
        this.introScreens = ['none', 'intro', 'info', 'infoSettings', 'contact', 'selfie', 'threeWords'];
        [goSettings].concat(Array.from(document.querySelectorAll(".next"))).forEach(button => button.onclick = () => this.nextIntroScreen());
        Array.from(document.querySelectorAll(".back")).forEach(button => button.onclick = () => this.previousIntroScreen());

        takeSelfie.onclick = () => this.takeSelfie();
        retakeSelfie.onclick = () => this.setupSelfie();
        reset.onclick = () => this.reset();
        cloud.addEventListener('wordcloudstop', () => { console.log('wordcloudstop', cloud.dataset.userId, this.publish); this.publish(cloud.dataset.userId, 'renderedCloud');});
        showQR.onclick = () => this.showQR();
    }
    logMessage(message) { // When showing messages in the app pesudoConsole.
        const item = document.createElement('DIV');
        item.innerHTML = message;
        pseudoConsole.append(item);
    }
    log(...args) {
        if (Q.LOCAL_LOG) return console.log(...args);
        this.logMessage(args.join(' '));
    }
    findUser(userId) { // If we have a view.
        return this.users.get(userId);
    }
    idKey() { return Q.APP_VERSION + ' UserId'; } // This version's key in localStorage.
    uuidv4() { // Not crypto strong, but good enough for prototype.
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    ensureLocalModel(viewId) { // When anyone joins, make sure WE have a model.
        this.log('ensureLocalModel', viewId, this.viewId, Q.APP_VERSION);
        if (viewId !== this.viewId) return; // Not for us to act on.
        const idKey = this.idKey(),
              userId = localStorage.getItem(idKey) || (localStorage.setItem(idKey, this.uuidv4()), localStorage.getItem(idKey)),
              // If the snasphot is current, the constructor would have created our view if we were already in the model
              existingView = this.findUser(userId);
        this.log('ensureLocalModel', userId, 'existingView:', existingView);
        if (existingView) {
            return this.startup(existingView); // set up our existing view.
        }
        this.log('ensureLocalModel publish', this.sessionId, 'addUser', userId);
        this.publish(this.sessionId, 'addUser', userId); // Tell everyone to create us.
    }
    addUserView(userId) { // A post-snapshot model has been created for this userId. Now make the view.
        this.log('addUserView', userId);
        const userModel = this.model.findUser(userId);
        if (!userModel) return; // can happen in the presence of people resetting
        const userView = new UserView(userModel);
        this.users.set(userId, userView);
        if (userId !== localStorage.getItem(this.idKey())) return; // The view is for a different user. We're done.
        this.startup(userView);
    }
    reset() {
        return alert('FIXME: not working yet!');
        const idKey = this.idKey(),
              me = this.me && this.me.model;
        this.me = undefined;
        /*
        Object.keys(localStorage).forEach(key => {
            if (/^(know|rate)\s?me/.test(key.toLowerCase())) {
                localStorage.removeItem(key);
            }
        });*/
        localStorage.clear();
        if (me) {
            // FIXME: In real app, this should wipe out the name, but for debugging for now...
            this.publish(me.userId, 'setContact', {name: me.contactName + ' deleted'});
            this.publish(me.userId, 'setPosition', {});
        }
        this.ensureLocalModel(this.viewId);
    }
    startup(me) {
        // FIXME: is this still true?
        // It is possible to get startup twice, by this scenario and similar (slightly different orders):
        // Previous session published addUser, but no snapshot created.
        // So this session starts with that method, resulting in addUserView => startup.
        // Then this session also gets an ensureLocalModel as always, finding an existingView and ends up here.
        if (this.me) {
            console.log('FIXME got double startup', me);
            return this.me;
        }
        this.me = me;
        this.log('startup', me);
        navigator.geolocation.getCurrentPosition(position => {
            const coords = position.coords;
            this.log('got position', position, 'for', me.model.userId);
            this.publish(me.model.userId, 'setPosition', {
                position: [coords.latitude, coords.longitude],
                accuracy: coords.accuracy});
        }, fail => {
            this.log('position failed', fail);
        }, {
            enableHighAccuracy: true
        });
        if (!me.model.initial || !me.model.photo) {
            this.nextIntroScreen();
        } 
        return me;
    }
    computeNearby() { // Answer a sorted list of only those UserViews that are "near" me.
        const me = this.me,
              myPosition = me.model.position,
              users = [];
        for (const [userId, view] of this.users) {
            let model = view.model;
            if (!model.position || (this.model.findUser(userId) !== model)) continue;
            view.distance = Math.hypot(model.position[0] - myPosition[0],
                                       model.position[1] - myPosition[1]);
            users.push(view);
        }
        users.sort((a, b) => Math.sign(a.distance - b.distance));
        return users;
    }
    hasRecentPosition(model = this.me && this.me.model) {
        return model && model.position; // FIXME
    }
    displayNearby() { // If ready (e.g., setup, not focused on someone, and geo are completed), display the nearby UserViews.
        if (!this.me) {
            return;
        }
        const model = this.me && this.me.model;
        if (!model || !model.initial || !model.photo || !this.hasRecentPosition(model)
            || !setup.classList.contains('none')
            || nearby.classList.contains('hasSelection')) return this.log('displayNearby notReady.', this.me);
        const old = nearby.children,
              next = this.computeNearby().map(user => user.avatar);
        this.log('displayNearby old:', old, 'next:', next);
        if ((old.length === next.length) && next.every((e, i) => e === old[i])) return this.log('displayNearby unchanged');;
        this.log('displayNearby appending', next);
        // FIXME: IWBNI the changes animated somehow
        nearby.innerHTML = '';
        next.forEach(avatar => nearby.append(avatar));
    }
    setupForVisible(screen) {
        const me = this.me;
        switch (screen) {
        case 'none':
            this.displayNearby();
            break;
        case 'contact':
            contactName.value = me.model.contactName || '';
            break;
        case 'selfie':
            if (me.model.photo) {
                this.initConfirmSelfie(me.model.photo);
            } else {
                this.setupSelfie();
            }
            break;
        case 'threeWords':
            word1.value = me.model.word1 || '';
            word2.value = me.model.word2 || '';
            word3.value = me.model.word3 || '';
            break;
        }
    }
    acceptLoseVisibility(screen) {
        const me = this.me;
        switch (screen) {
        case 'contact':
            this.publish(me.model.userId, 'contact', {name: contactName.value});
            break;
        case 'selfie':
            this.publish(this.me.model.userId, 'photo', selfieImg.getAttribute('src'));
            break;
        case 'threeWords':
            this.publish(me.model.userId, 'threeWords', [word1.value, word2.value, word3.value]);
            break;
        }
    }
    nextIntroScreen(increment = 1) {
        const current = setup.className,
              index = this.introScreens.indexOf(current),
              nextIndex = (index + increment) % this.introScreens.length,
              next = this.introScreens[nextIndex];
        this.log('nextIntroScreen', current, index, nextIndex, next, this);
        if (increment > 0) this.acceptLoseVisibility(current);
        setup.className = next;
        this.setupForVisible(next);
    }
    previousIntroScreen() {
        this.nextIntroScreen(-1);
    }    
    initConfirmSelfie(url) {
        selfieImg.setAttribute('src', url);
        selfie.classList.remove('lineup');
        takeSelfie.disabled = true;
        retakeSelfie.disabled = false;
    }
    setupSelfie() {
        selfie.classList.add('lineup');
        takeSelfie.disabled = false;
        retakeSelfie.disabled = true;
        navigator
            .mediaDevices
            .getUserMedia({ video: true })
            .then(stream => selfieVideo.srcObject = stream);
    }
    takeSelfie() {
        var canvas = selfieCanvas;
        canvas.width = selfieVideo.videoWidth;
        canvas.height = selfieVideo.videoHeight;
        canvas.getContext('2d').drawImage(selfieVideo, 0, 0, canvas.width, canvas.height);
        while (canvas.width >= (2 * 400)) { // Protect agains big cameras
            canvas = this.getHalfScaleCanvas(canvas);
        }
        this.initConfirmSelfie(canvas.toDataURL('image/png'));
        selfieVideo.srcObject.getTracks().forEach(track => track.stop());
    }
    getHalfScaleCanvas(canvas) { // Non-power of two scaling is slow, but this is speedy.
        var halfCanvas = document.createElement('canvas');
        halfCanvas.width = canvas.width / 2;
        halfCanvas.height = canvas.height / 2;
        halfCanvas.getContext('2d').drawImage(canvas, 0, 0, halfCanvas.width, halfCanvas.height);
        return halfCanvas;
    }
    showQR() {
        showQR.classList.toggle('showing');
        if (!showQR.classList.contains('showing')) return;
        var generator = qrcode(0, 'H');
        this.log('qr', generator);
        generator.addData('https://howard-stearns.github.io/reputation/');
        generator.make();
        qr.innerHTML = generator.createImgTag(15);
    }
}

class UserView extends Croquet.View {
    constructor(model) {
        super(model);
        this.model = model;
        const avatar = document.importNode(avatarTemplate.content.firstElementChild, true);
        this.avatar = avatar;
        this.list = []; // defensive programming
        this.updateDisplay(avatar, model);
        avatar.onclick = () => this.toggleSelection();
        this.subscribe(model.userId, 'updateDisplay', this.updateDisplay);
        this.subscribe(model.userId, 'renderedCloud', this.renderedCloud);
    }
    log(...args) {
        if (Q.LOCAL_LOG) return console.log(...args);        
        this.publish(this.sessionId, 'log', args.join(' '));
    }
    updateDisplay(avatar = this.avatar, model = this.model) {
        avatar.querySelector('span').textContent = this.model.initial;
        const img = avatar.querySelector('img');
        if (model.photo) img.src = model.photo;
        else if (model.color) img.style.backgroundColor = model.color;
    }
    toggleSelection() {
        const target = this.avatar, parent = target.parentElement;
        const index = Array.prototype.indexOf.call(parent.children, target);
        const columnWidths = getComputedStyle(parent).gridTemplateColumns.split(/\s+/);
        const nColumns = columnWidths.length, column = index % nColumns, width = parseInt(columnWidths[column]);
        target.classList.toggle('selected');
        parent.classList.toggle('hasSelected');
        const isSelected = target.classList.contains('selected');
        target.style.left = isSelected ? `-${column * width}px` : "0";
        if (isSelected) {
            this.initRater();
        } else {
            this.publish(this.sessionId, 'displayNearby');
        }
    }
    initRater() {
        this.renderCloud();
        this.initAutocomplete();
    }
    
    showWordChoice(span, border, fontStyle, increment) {
        span.style.border = border;
        span.style.fontStyle = fontStyle;
        this.publish(this.model.userId, 'rate', {word: span.textContent, increment: increment});
    }
    updateForNewSpanChoice(span, increment = 1, event) {
        const previousSpan = this.yourPick;
        if (previousSpan) {
            this.showWordChoice(previousSpan, "none", "normal", -1);
        }
        this.yourPick = span;
        this.showWordChoice(span, "solid", "italic", increment);
        if (event) event.stopPropagation();
    }
    eachCloudSpan(f) {
        const spans = cloud.querySelectorAll('span');
        for (let span of spans) {
            const val = f(span);
            if (val) return val;
        }
    }
    autocompleteWordList() { // wants [{label: word}, ...]
        const wordMap = this.model.wellKnownModel('modelRoot').words,
              words = Array.from(wordMap.keys());
        words.sort((a, b) => Math.sign(wordMap.get(b) - wordMap.get(a)));
        // Count isn't used in the following, except for debugging.
        return words.map(word => ({label: word, count: words[word]}));
    }
    cloudWordList() { // Wants [[word, count], ...]
        const list = Array.from(this.model.words.entries());
        list.sort((a, b) => Math.sign(b[1] - a[1])); // Biggest counts first.
        this.log('cloudWordList', list, this);
        return list;
    }
    renderedCloud() {
        // ...debug missing words. FIXME: should we re-render at lower weightFactor?
        const spans = cloud.querySelectorAll('span');
        const words = Array.from(spans).map(s => s.textContent);
        this.list.forEach(pair => { if (!words.includes(pair[0])) this.log('MISSING', pair); })

        // ... add click handlers, and pre-select if needed.
        this.eachCloudSpan(span => {
            span.onclick = event => this.updateForNewSpanChoice(span, 1, event);
            if (this.yourPick === span.textContent) {
                this.updateForNewSpanChoice(span, 0);
            }                    
        });
    }
    renderCloud() {
        this.list = this.cloudWordList();
        var weightFactor = 30; // FIXME: adapt this as needed
        
        this.yourPick = null;
        cloud.innerHTML = ''; // Faster than removing each child, as it avoids multiple reflows.
        cloud.dataset.userId = this.model.userId;

        WordCloud(cloud, {
            list: this.list,
            shape: 'circle', // 'diamond' is more likely to not fit all the words
            backgroundColor: '#0',
            color: 'random-light',
            weightFactor: weightFactor
            //minSize: 10 // The weight of the word in the list must be ABOVE this value to be shown
        });
    }
    initAutocomplete() {
        const user = this,
              wordChoicesForAutocomplete = user.autocompleteWordList();
        wordInput.value = '';
        autocomplete({
            input: wordInput,
            minLength: 1,
            fetch: function(text, update) {
                text = text.toLowerCase();
                var suggestions = wordChoicesForAutocomplete.filter(n => n.label.startsWith(text))
                update(suggestions);
            },
            onSelect: function(item) {
                const word = item.label
                wordInput.value = word;
                function clickSpanIfFound(span) {
                    if (span.textContent === word) {
                        user.updateForNewSpanChoice(span);
                        return true;
                    }
                }
                if (!user.eachCloudSpan(clickSpanIfFound)) {
                    this.publish(this.model.userId, 'rate', {word: word});
                    this.yourPick = word;
                    user.renderCloud(); // FIXME- after round trip
                }
            }
        });
    }
}

[WordCountModel, UserverseModel, UserModel].forEach(model => model.register());
Croquet.startSession(document.title, UserverseModel, UserverseView);

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    console.log('beforeinstallprompt', e);
    deferredPrompt = e;
    window.alert('This page can be installed on the home screen. More to come...' + JSON.stringify(e));
    deferredPrompt.prompt();
    deferredPrompt.userChoice
        .then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                window.alert('User accepted the A2HS prompt');
            } else {
                window.alert('User dismissed the A2HS prompt');
            }
            deferredPrompt = null;
        });
});

window.addEventListener('appinstalled', (evt) => {
  window.alert('a2hs installed');
});
