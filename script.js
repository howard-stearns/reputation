'use strict';
/* 
TODO:
- date of picture change
- lower res pictures, and jpeg?

- Always show the nearest online: max of either 16 or within your accuracy (no slider)
- online/offline w/position
- filter picker display by n|distance

- endorse pick/display
- share contact info

- how do we set weightFactor? iterate?

- add to homescreen prompt 
  (https://stackoverflow.com/questions/47559051/ios-devices-add-website-to-homescreen-as-web-app-not-shortcut
   https://github.com/cubiq/add-to-homescreen,
   https://stackoverflow.com/questions/50332119/is-it-possible-to-make-an-in-app-button-that-triggers-the-pwa-add-to-home-scree/50356149#50356149)

- QR code
- better picture of eleanor
- setup cleanup

=> Good enough to be criticized?

- share interaction preferences
- pending words: collect for voting; secret password to show upvoted words and approve them
- rate this app
- lockout time (against revoting)
- public figure of the day

TBD:
- Is there a way to make voting more anonymous by messing with the time at which it shows up - while still staying current enough?
*/

// For this prototype, instead of an application-specific server that gives you just the data you need (of the potential billion users),
// we just make sure that everyone has an in-memory copy of all the data. For that purpose we purpose, the prototype uses croquet.studio,
// whose job it is to keep that in-memory copf of the models in sync, replicated it among all the users (either immediately, or when they
// come online). This allows the prototype app to work without any application-specific server at all!

const Q = Croquet.Constants; // Shared among all participants, and part of the hashed definition to be replicated.

Q.APP_VERSION = "KnowMe 0.0.21"; // Rev'ing guarantees a fresh model (e.g., when view usage changes incompatibly during development).

// Just used in initializing the userverse. Change this constant, and you've fractured the userverse into old and new sets!
Q.INITIAL_WORD_LIST = `considerate courteous courageous adventurous
inventive philosophical persistent practical sensible logical rational
sincere ernest unassuming funny witty clever kind compassionate
empathetic sympathetic talented adaptable reliable diligent fair
impartial skilled exciting resourceful knowledgeable ambitious
passionate exuberant frank generous persuasive approachable friendly
gregarious wise`;

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
             photo: "https://www.biography.com/.image/ar_1:1%2Cc_fill%2Ccs_srgb%2Cg_face%2Cq_auto:good%2Cw_300/MTE5NDg0MDU1MTUzMTE2Njg3/alan-turing-9512017-1-402.jpg"},
            {name: "Oscar Wilde", words: "historian witty gregarious naturalist charming talented exuberant ernest adventurous",
             photo: "https://www.onthisday.com/images/people/oscar-wilde-medium.jpg"},
            {name: "Cleopatra", words: "persuasive ambitious patriotic resourceful adaptable knowledgeable passionate exciting courageous adventurous persistent witty skilled",
             photo: "https://patch.com/img/cdn/users/21124/2013/01/raw/76a17acb3967536fb4f87fb31c0be86b.jpg?width=725"},
            {name: "Eleanor Roosevelt", words: "kind compassionate spiritual resourceful persuasive knowledgeable courageous",
             photo: "http://www.firstladies.org/biographies/images/EleanorRoosevelt.jpg"}
        ].map(options => UserModel.create(options));

        this.subscribe(this.sessionId, 'ensureUserId', this.ensureUserId);
    }
    ensureUserId(userId) {
        // Depending on when snapshot is taken, reload can give us a second ensureUserId message. Make sure it's in the model.
        console.log('ensureUserId', userId, 'among', this.users);
        var userModel = this.users.find(user => user.userId === userId);
        if (userModel) return;

        userModel = UserModel.create({userId: userId});
        this.users.push(userModel);
        this.publish(this.sessionId, 'announceNewUser', userId);
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
    }
    initDeadPerson({name, words, photo}) { // Set up as an always "online" person to play with.
        this.userId = name;
        this.setContact({name: name});
        this.setPhoto(photo);
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
        console.log('setPhoto', url, this);
        this.photo = url;
        // FIXME set date
        // FIXME: decide where to check against changes. here or view?
        this.publish(this.userId, 'updateDisplay');
    }
    setContact({name}) {
        console.log('setContact', name, this);
        this.contactName = name;
        this.initial = name[0];
        // FIXME more
        this.publish(this.userId, 'updateDisplay');
    }
    setThreeWords([word1, word2, word3]) {
        console.log('setThreeWords', word1, word2, word3);
        this.maybeUpdateWord(word1, 'word1', 2);
        this.maybeUpdateWord(word2, 'word2', 1);
        this.maybeUpdateWord(word3, 'word3', 1);
        this.publish(this.userId, 'updateDisplay');
    }
    maybeUpdateWord(newWord, key, weight = 1) {
        const oldWord = this[key];
        console.log('maybeUpdateWord', newWord, key, oldWord, weight);
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
        this.subscribe(this.sessionId, "view-join", this.requestIdCheck);
        this.subscribe(this.sessionId, 'announceNewUser', this.announceNewUser);
        this.displayNearby();
        
        this.introScreens = ['none', 'intro', 'info', 'infoSettings', 'contact', 'selfie', 'threeWords'];
        [goSettings].concat(Array.from(document.querySelectorAll(".next"))).forEach(button => button.onclick = () => this.nextIntroScreen());
        Array.from(document.querySelectorAll(".back")).forEach(button => button.onclick = () => this.previousIntroScreen());

        takeSelfie.onclick = () => this.takeSelfie();
        retakeSelfie.onclick = () => this.setupSelfie();
        acceptSelfie.onclick = () => this.acceptSelfie();
    }
    ensureLocalId() { // What is my locally stored anonymous id?
        const idKey = document.title + 'UserId';
        // Note: Even when bootstrapping, there is a zero user with no local storage.
        return localStorage.getItem(idKey) || (localStorage.setItem(idKey, this.model.users.length), localStorage.getItem(idKey));
    }
    requestIdCheck(viewId) {
        console.log('requestIdCheck', viewId, this.viewId, Q.APP_VERSION);
        if (viewId !== this.viewId) return; // Not for us to act on.
        this.publish(this.sessionId, 'ensureUserId', this.ensureLocalId());
    }
    ensureMe() {
        if (this.me) return this.me;
        const userId = this.ensureLocalId();
        this.me = this.users.find(user => user.model.userId === userId);
        if (this.me) return this.me;
        throw new Error(`No user view found for ${userId}.`);
    }
    announceNewUser(userId) {
        for (let index = this.model.users.length; index > 0;) {
            let userModel = this.model.users[--index],
                match = userModel.userId === userId;
            if (!match) continue;
            console.log('announceNewUser', userId, 'photo:', userModel.photo);
            this.me = new UserView(userModel);
            this.users.push(this.me)
            nearby.append(this.me.avatar);
            if (!userModel.initial || !userModel.photo) this.nextIntroScreen();
            return;
        }
    }
    computeNearby() {
        return this.users; // FIXME: filter by online, sort by distance, filter by max/accuracy
    }
    displayNearby() {
        nearby.innerHTML = '';
        this.computeNearby().forEach(user => nearby.append(user.avatar));
    }
    setupForVisible(screen) {
        const me = this.ensureMe();
        switch (screen) {
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
    acceptLooseVisibility(screen) {
        const me = this.ensureMe();
        switch (screen) {
        case 'contact':
            this.publish(me.model.userId, 'contact', {name: contactName.value});
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
        this.acceptLooseVisibility(current);
        this.setupForVisible(next);
        setup.className = next;
    }
    previousIntroScreen() {
        this.nextIntroScreen(-1);
    }
    initConfirmSelfie(url) {
        console.log('image data url', url);
        selfieImg.setAttribute('src', url);
        selfie.classList.remove('lineup');
        takeSelfie.disabled = true;
        retakeSelfie.disabled = acceptSelfie.disabled = false;
    }
    setupSelfie() {
        selfie.classList.add('lineup');
        takeSelfie.disabled = false;
        retakeSelfie.disabled = acceptSelfie.disabled = true;
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
    acceptSelfie() {
        this.publish(this.me.model.userId, 'photo', selfieImg.getAttribute('src'));
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
        if (isSelected) this.initRater();
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
        const cloud = this.avatar.querySelector('.cloud'),
              spans = cloud.querySelectorAll('span');
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
        return list;
    }
    renderCloud(selectedWord = null) {
        const user = this;
        const cloud = this.avatar.querySelector('.cloud');
        const list = user.cloudWordList();
        this.yourPick = null;
        cloud.innerHTML = ''; // Faster than removing each child, as it avoids multiple reflows.

        cloud.addEventListener('wordcloudstop', e => { // When rendering completes..

            // ...debug missing words. FIXME: should we re-render at lower weightFactor?
            const spans = cloud.querySelectorAll('span');
            const words = Array.from(spans).map(s => s.textContent);
            list.forEach(pair => { if (!words.includes(pair[0])) console.log('MISSING', pair); })

            // ... add click handlers, and pre-select if needed.
            user.eachCloudSpan(span => {
                span.onclick = event => user.updateForNewSpanChoice(span, 1, event);
                if (selectedWord === span.textContent) {
                    user.updateForNewSpanChoice(span, 0);
                }                    
            });
        });
        WordCloud(cloud, {
            list: list,
            shape: 'circle', // 'diamond' is more likely to not fit all the words
            backgroundColor: '#0',
            color: 'random-light',
            weightFactor: 3
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
                    user.renderCloud(word); // FIXME- after round trip
                }
            }
        });
    }
}


[WordCountModel, UserverseModel, UserModel].forEach(model => model.register());
Croquet.startSession(document.title, UserverseModel, UserverseView);
