'use strict';
/* 
TODO:
- pick a user

- online/offline w/position
- filter picker display by n|distance

- mobile layout
- github pages availability

- how do we set weightFactor? iterate?

- settings: pick a picture, set initial
- first-use: settings
- pick your own three words

- add to homescreen prompt 
  (https://stackoverflow.com/questions/47559051/ios-devices-add-website-to-homescreen-as-web-app-not-shortcut
   https://github.com/cubiq/add-to-homescreen,
   https://stackoverflow.com/questions/50332119/is-it-possible-to-make-an-in-app-button-that-triggers-the-pwa-add-to-home-scree/50356149#50356149)
- QR code
- n|distance sliders

- share contact info
- share interaction preferences
- first-use: tour
- pending words: collect for voting; secret password to show upvoted words and approve them
- rate this app
*/

const Q = Croquet.Constants; // Shared among all participants, and part of the hashed definition to be replicated.
Q.APP_VERSION = "RateMe 0.0.13"; // Rev'ing guarantees a fresh model (e.g., when view usage changes incompatibly during development).
// Just used in initializing the userverse. Change this constant, and you've fractured the userverse into old and new sets!
Q.INITIAL_WORD_LIST = `considerate courteous courageous adventurous
inventive philosophical persistent practical sensible logical rational
sincere ernest unassuming funny witty clever kind compassionate
empathetic sympathetic talented adaptable reliable diligent fair
impartial skilled exciting resourceful knowledgeable ambitious
passionate exuberant frank generous persuasive approachable friendly
gregarious wise`;

class WordCountModel extends Croquet.Model { // Maintains a map of word => count
    init(options) {
        super.init(options);
        this.words = new Map();
    }
    incrementWordCount(word, increment = 1) {
        const was = this.words.get(word) || 0;
        this.words.set(word, was + increment);
    }
}

    
// All the users, and the data that is common to all users. Could have multiples if we want to support factions.
class UserverseModel extends WordCountModel { 
    init(options) { // Initial data for this userverse.
        console.log('UserverseModel#init', options, this);
        super.init(options);
        
        this.words = new Map(Q.INITIAL_WORD_LIST.split(/\s/).map(word => [word, 0]));
        // A list of all users. For demo and development, we start with a zero user so there is always at least one to play with.
        this.users = []; //[UserModel.create({userId: 0})]; // subtle: no user with local storage will ever be userId:0.
        for (let i = 0; i < 16; i++) { // FIXME
            this.users.push(UserModel.create({userId: 0}));
        }

        this.subscribe(this.sessionId, 'ensureUserId', this.ensureUserId);
    }
    ensureUserId(userId) {
        // Depending on when snapshot is taken, reload can give us a second ensureUserId message. Make sure it's not in the model.
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
        console.log('UserModel#init', options, this);
        super.init(options);
        const userId = options.userId;
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
        this.subscribe(userId, 'rate', this.rate);
    }
    random_hsl_color(min, max) {
      return 'hsl(' +
        (Math.random() * 360).toFixed() + ',' +
        (Math.random() * 30 + 70).toFixed() + '%,' +
        (Math.random() * (max - min) + min).toFixed() + '%)';
    }

    rate({word, increment = 1}) {
        this.incrementWordCount(word, increment);
    }
    incrementWordCount(word, increment = 1) {
        // FIXME: keep a local copy of the pending net change (one word incremented by 1) and
        // submit that some random time later, to keep feedback anonymous. But for
        // now for demo purposes, it's nice to see the change.
        super.incrementWordCount(word, increment);
        this.wellKnownModel('modelRoot').incrementWordCount(word, increment);
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
    }
    requestIdCheck(viewId) {
        console.log('requestIdCheck', viewId, this.viewId, Q.APP_VERSION);
        if (viewId !== this.viewId) return; // Not for us to act on.
        const idKey = document.title + 'UserId',
              // Note: Even when bootstrapping, there is a zero user with no local storage.
              userId = localStorage.getItem(idKey) || (localStorage.setItem(idKey, this.model.users.length), localStorage.getItem(idKey));
        this.publish(this.sessionId, 'ensureUserId', userId);
    }
    announceNewUser(userId) {
        console.log('announceNewUser', userId);
        /*
        for (let index = this.model.users.length; index > 0;) {
            let userModel = this.model.users[--index],
                match = userModel.userId === userId;
            if (match) {
                this.latest = new UserView(userModel);  // FIXME
            }
        }*/
    }
    computeNearby() {
        return this.users; // FIXME: filter by online, then by sorted n|distance
    }
    displayNearby() {
        nearby.innerHTML = '';
        this.computeNearby().forEach(user => nearby.append(user.avatar));
    }
}

class UserView extends Croquet.View {
    constructor(model) {
        super(model);
        this.model = model;
        const avatar = document.importNode(avatarTemplate.content.firstElementChild, true);
        this.avatar = avatar;
        avatar.querySelector('span').textContent = this.model.initial;
        avatar.querySelector('img').style.backgroundColor = this.model.color;
        avatar.onclick = () => this.toggleSelection();
    }
    toggleSelection() {
        console.log('toggleSelection', this.avatar);
        const target = this.avatar, parent = target.parentElement;
        const index = Array.prototype.indexOf.call(parent.children, target);
        const columnWidths = getComputedStyle(parent).gridTemplateColumns.split(/\s/);
        const nColumns = columnWidths.length, column = index % nColumns, width = parseInt(columnWidths[column]);
        target.classList.toggle('selected');
        parent.classList.toggle('hasSelected');
        const isSelected = target.classList.contains('selected');
        target.style.left = isSelected ? `-${column * width}px` : "0";
        if (isSelected) this.initRater();
    }
    initRater() {
        console.log('initRater', this);
        this.renderCloud();
        this.initAutocomplete();
    }
    
    showWordChoice(span, border, fontStyle, increment) {
        console.log('updating', border, fontStyle, increment, span);
        span.style.border = border;
        span.style.fontStyle = fontStyle;
        this.publish(this.model.userId, 'rate', {word: span.textContent, increment: increment});
    }
    updateForNewSpanChoice(span, increment = 1, event) {
        const previousSpan = this.yourPick;
        console.log('Switching choice from', previousSpan, 'to', span);
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
        const dataDisplay = this.avatar.querySelector('.dataDisplay');
        const cloud = dataDisplay.querySelector('.cloud');
        const list = user.cloudWordList();
        this.yourPick = null;
        cloud.innerHTML = ''; // Faster than removing each child, as it avoids multiple reflows.
        dataDisplay.classList.add('on');

        console.log('wordcloud ok:', WordCloud.isSupported, WordCloud.minFontSize, list);
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
        console.log('setting autocomplete on', wordInput, 'over', wordChoicesForAutocomplete);
        autocomplete({
            input: wordInput,
            minLength: 1,
            fetch: function(text, update) {
                text = text.toLowerCase();
                var suggestions = wordChoicesForAutocomplete.filter(n => n.label.startsWith(text))
                console.log('fetch for', text, 'suggesting', suggestions, 'to', update);
                update(suggestions);
            },
            onSelect: function(item) {
                const word = item.label
                console.log('select', word);
                wordInput.value = word;
                function clickSpanIfFound(span) {
                    if (span.textContent === word) {
                        user.updateForNewSpanChoice(span);
                        return true;
                    }
                }
                if (!user.eachCloudSpan(clickSpanIfFound)) {
                    user.model.incrementWordCount(word);
                    user.renderCloud(word);
                }
            }
        });
    }
}


[WordCountModel, UserverseModel, UserModel].forEach(model => model.register());
Croquet.startSession(document.title, UserverseModel, UserverseView);
