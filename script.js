'use strict';
/* 
TODO:

- add to homescreen prompt 
  (https://stackoverflow.com/questions/47559051/ios-devices-add-website-to-homescreen-as-web-app-not-shortcut
   https://github.com/cubiq/add-to-homescreen,
   https://stackoverflow.com/questions/50332119/is-it-possible-to-make-an-in-app-button-that-triggers-the-pwa-add-to-home-scree/50356149#50356149)

- QR code
- share contact info

- endorse pick/display
- date of picture change
- lower res pictures, and jpeg?
- better picture of eleanor
- message for word that does not complete
- setup cleanup

=> Good enough to be criticized?

- geo:
  . right now, we only get position and sort when you open app. When should we we update that?
  . computeNearby should limit those within accuracy, if that's less than some limit, otherwise some limit N.
  . should we show yourself with the nearby, or only in settings, or what?
- dynamically adjust wordcloud weight
- pending words: collect for voting; secret password to show upvoted words and approve them
- share interaction preferences
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

Q.APP_VERSION = "KnowMe 0.0.34"; // Rev'ing guarantees a fresh model (e.g., when view usage changes incompatibly during development).

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
}
    
// Database of the users, and the data that is common to all users (available words). Could have multiples if we want to support factions.
class UserverseModel extends WordCountModel { 
    init(options) { // Initial data for this userverse.
        console.log('init UserverseModel', options, this);
        super.init(options);

        // The list of blessed/localizeable words, with a word count so that they be ordered for autocomplete.
        this.words = new Map(Q.INITIAL_WORD_LIST.split(/\s+/).map(word => [word, 0]));

        // The list of all users.
        this.users = [ // Set up some universally available dead people, so that there's always someone to work with.
            {name: "Alan Turing", words: "curious logical resourceful knowledgeable persistent kind practical rational",
             position: [51.9977, 0.7407],
             photo: "https://www.biography.com/.image/ar_1:1%2Cc_fill%2Ccs_srgb%2Cg_face%2Cq_auto:good%2Cw_300/MTE5NDg0MDU1MTUzMTE2Njg3/alan-turing-9512017-1-402.jpg"},
            {name: "Oscar Wilde", words: "historian witty gregarious naturalist charming talented exuberant ernest adventurous",
             position: [48.860000, 2.396000],
             photo: "https://www.onthisday.com/images/people/oscar-wilde-medium.jpg"},
            {name: "Cleopatra", words: "persuasive ambitious patriotic resourceful adaptable knowledgeable passionate exciting courageous adventurous persistent witty skilled",
             position: [31.200000, 29.916667],
             photo: "https://patch.com/img/cdn/users/21124/2013/01/raw/76a17acb3967536fb4f87fb31c0be86b.jpg?width=725"},
            {name: "Eleanor Roosevelt", words: "kind compassionate spiritual resourceful persuasive knowledgeable courageous",
             position: [41.7695366,-73.938733],
             photo: "http://www.firstladies.org/biographies/images/EleanorRoosevelt.jpg"}
        ].map(options => UserModel.create(options));

        this.subscribe(this.sessionId, 'addUserModel', this.addUserModel);
        this.subscribe(this.sessionId, 'removeUser', this.removeUser);
    }
    findUser(userId) {
        return this.users.find(user => user.userId === userId);
    }
    addUserModel(userId) {
        console.log('addUserModel', userId, 'among', this.users);
        this.users.push(UserModel.create({userId: userId}));
        this.publish(this.sessionId, 'addUserView', userId);
    }
    removeUser(userId) {
        console.log('removeUser', userId);
        this.users = this.users.filter(user => user.userId !== userId);
        this.publish(this.sessionId, 'displayNearby');
    }
}

class UserModel extends WordCountModel { // Each user's data
    init(options) { // Initial random demo data.
        console.log('init UserModel', options, this);
        super.init(options);
        if (options.name) {
            this.initDeadPerson(options);  // Name at init time only happens with the sample users.
        } else {
            //this.initRandom(options);
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
    initRandom({userId}) { // For demo purposes, start the suer with random data.
        this.userId = userId;
        this.initial = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 16)];
        this.color = this.random_hsl_color(10, 50);
        this.ratedBy = [userId];
        // Note: not really max weight, because there's nothing prevening a "double shot", where the word gets picked twice.
        const MIN_RANDOM_WORDS = 5, MAX_RANDOM_WORDS = 20, MAX_RANDOM_WEIGHT = 30;
        const userverse = this.wellKnownModel('modelRoot'),
              allWords = Array.from(userverse.words.keys()),
              nAllWords = allWords.length,
              spread = (1 + MAX_RANDOM_WORDS - MIN_RANDOM_WORDS);
        for (let nWords = MIN_RANDOM_WORDS + Math.floor(this.random() * spread);
             nWords > 0;
             nWords--) {
            let index = Math.floor(this.random() * nAllWords), // pick a word
                count = Math.ceil(this.random() * MAX_RANDOM_WEIGHT) || 1; // r endorsements for that word
            this.incrementWordCount(allWords[index], count);
        }
    }
    random_hsl_color(min, max) {
      return 'hsl(' +
        (Math.random() * 360).toFixed() + ',' +
        (Math.random() * 30 + 70).toFixed() + '%,' +
        (Math.random() * (max - min) + min).toFixed() + '%)';
    }

    incrementWordCount(word, increment = 1) {
        super.incrementWordCount(word, increment);
        this.wellKnownModel('modelRoot').incrementWordCount(word, increment);
    }
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
        console.log('setPosition', position, accuracy, 'for', this.userId);
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
        this.maybeUpdateWord(word1, 'word1', 2);
        this.maybeUpdateWord(word2, 'word2', 1);
        this.maybeUpdateWord(word3, 'word3', 1);
        this.publish(this.userId, 'updateDisplay');
    }
    maybeUpdateWord(newWord, key, weight = 1) {
        const oldWord = this[key];
        if (newWord === oldWord) return false;
        if (oldWord) this.incrementWordCount(oldWord, 0 - weight);
        if (newWord) this.incrementWordCount(newWord, weight);
        this[key] = newWord;
        return true;
    }
}

class UserverseView extends Croquet.View { // Local version for display.
    constructor(model) {
        super(model);
        this.model = model;
        this.users = this.model.users.map(userModel => new UserView(userModel));
        this.subscribe(this.sessionId, "view-join", this.ensureModel);
        this.subscribe(this.sessionId, 'addUserView', this.addUserView);
        this.subscribe(this.sessionId, 'displayNearby', this.displayNearby);
        
        this.introScreens = ['none', 'intro', 'info', 'infoSettings', 'contact', 'selfie', 'threeWords'];
        [goSettings].concat(Array.from(document.querySelectorAll(".next"))).forEach(button => button.onclick = () => this.nextIntroScreen());
        Array.from(document.querySelectorAll(".back")).forEach(button => button.onclick = () => this.previousIntroScreen());

        takeSelfie.onclick = () => this.takeSelfie();
        retakeSelfie.onclick = () => this.setupSelfie();
        reset.onclick = () => this.reset();
        cloud.addEventListener('wordcloudstop', () => { console.log('wordcloudstop', cloud.dataset.userId, this.publish); this.publish(cloud.dataset.userId, 'renderedCloud');});
    }
    findUser(userId) {
        return this.users.find(user => user.model.userId === userId);
    }
    idKey() { return Q.APP_VERSION + ' UserId'; }
    ensureModel(viewId) {
        console.log('ensureModel', viewId, this.viewId, Q.APP_VERSION);
        if (viewId !== this.viewId) return; // Not for us to act on.
        const idKey = this.idKey(),
              userId = localStorage.getItem(idKey) || (localStorage.setItem(idKey, this.model.users.length), localStorage.getItem(idKey)),
              // If the snasphot is current, the constructor would have created our view we were already in the model
              existingView = this.findUser(userId);
        console.log('ensureModel', userId, 'existingView:', existingView);
        if (existingView) {
            return this.startup(existingView);
        }
        this.publish(this.sessionId, 'addUserModel', userId);
    }
    addUserView(userId) {
        console.log('addUserView', userId);
        const userModel = this.model.findUser(userId);
        if (!userModel) return; // can happen in the presence of people resetting
        const userView = new UserView(userModel);
        this.startup(userView);
        this.users.push(userView);
    }
    reset() {
        const idKey = this.idKey(),
              existing = localStorage.getItem(idKey);
        Object.keys(localStorage).forEach(key => {
            if (/^(know|rate)\s?me/.test(key.toLowerCase())) {
                localStorage.removeItem(key);
            }
        });
        localStorage.removeItem(this.idKey);
        this.me = undefined;
        if (existing) {
            this.publish(this.sessionId, 'removeUser', existing);
        }
        setTimeout(() => location.reload(true), 250);
    }
    startup(me) {
        // It is possible to get startup twice, by this scenario and similar (slightly different orders):
        // Previous session published addUserModel, but not snapshot created.
        // So this session starts with that method, resulting in addUserView => startup.
        // Then this session also gets an ensureModel as always, finding an existingView and ends up here.
        if (this.me) return this.me;
        this.me = me;
        console.log('startup', me);
        navigator.geolocation.getCurrentPosition(position => {
            const coords = position.coords;
            console.log('got position', position, 'for', me.model.userId);
            this.publish(me.model.userId, 'setPosition', {
                position: [coords.latitude, coords.longitude],
                accuracy: coords.accuracy});
        }, fail => {
            console.log('position failed', fail);
        }, {
            enableHighAccuracy: true
        });
        if (!me.model.initial || !me.model.photo) {
            this.nextIntroScreen();
        } 
        return me;
    }
    computeNearby() {
        const me = this.me,
              myPosition = me.model.position,
              users = this.users.filter(user => this.model.users.includes(user.model) && user.model.position);
        users.forEach(user => user.distance = Math.hypot(user.model.position[0] - myPosition[0],
                                                         user.model.position[1] - myPosition[1]));
        users.sort((a, b) => Math.sign(a.distance - b.distance));
        return users;
    }
    hasRecentPosition(model = this.me && this.me.model) {
        return model && model.position; // FIXME
    }
    displayNearby() {
        const model = this.me && this.me.model;
        if (!model || !model.initial || !model.photo || !this.hasRecentPosition(model)
            || !setup.classList.contains('none')
            || nearby.classList.contains('hasSelection')) return console.log('displayNearby notReady.', this.me);
        const old = nearby.children,
              next = this.computeNearby().map(user => user.avatar);
        console.log('displayNearby old:', old, 'next:', next);
        if ((old.length === next.length) && next.every((e, i) => e === old[i])) return console.log('displayNearby unchanged');;
        console.log('displayNearby appending', next);
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
            word3.value = me.model.word2 || '';        
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
        console.log('nextIntroScreen', current, index, nextIndex, next, this);
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
        const width = selfieVideo.videoWidth,
              height = selfieVideo.videoHeight,
              context = selfieCanvas.getContext('2d');
        selfieCanvas.width = width;
        selfieCanvas.height = height;
        context.drawImage(selfieVideo, 0, 0, width, height);
        this.initConfirmSelfie(selfieCanvas.toDataURL('image/png'));
        selfieVideo.srcObject.getTracks().forEach(track => track.stop());
    }
}

class UserView extends Croquet.View {
    constructor(model) {
        super(model);
        this.model = model;
        const avatar = document.importNode(avatarTemplate.content.firstElementChild, true);
        this.avatar = avatar;
        this.updateDisplay(avatar, model);
        avatar.onclick = () => this.toggleSelection();
        this.subscribe(model.userId, 'updateDisplay', this.updateDisplay);
        this.subscribe(model.userId, 'renderedCloud', this.renderedCloud);
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
        debug.innerHTML = `debug: ${this.model.position}, ${this.model.accuracy}`;
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
        console.log('cloudWordList', list, this);
        return list;
    }
    renderedCloud() {
        // ...debug missing words. FIXME: should we re-render at lower weightFactor?
        const spans = cloud.querySelectorAll('span');
        const words = Array.from(spans).map(s => s.textContent);
        this.list.forEach(pair => { if (!words.includes(pair[0])) console.log('MISSING', pair); })

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
