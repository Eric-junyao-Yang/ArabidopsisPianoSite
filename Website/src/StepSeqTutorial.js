tutorialContent = {
    "step0": {
        "focus_object": "playButton",
        "content": "Before we dive into the plot, here are some selected genes to show you what the Step Sequencer can do. Press play! You can pause or stop at any time."
    },
    "step1": {
        "focus_object": "StepSeqMain",
        "content": "Neat right? Now less dive into what all this means."
    },    
    "step2": {
        "focus_object": "StepSeqMain",
        "content": "Here are 3286 Arabidopsis genes that are potentially oscillating. Each point is a gene."
    },
    "step3": {
        "focus_object": "StepSeqMain - y-axis",
        "content": "The y-axis shows the detected oscillating period of the gene."
    },
    "step4": {
        "focus_object": "StepSeqMain - x-axis",
        "content": "The x-axis shows the time where the waveform is detected to peak in the 48 hour experiment"
    },
    "step5": {
        "focus_object": "StepSeqMain - A row",
        "content": "This allows us to separate the multiple genes that share the same frequency, by separating them by when they peak."
    },
    "step5": {
        "focus_object": "StepSeqMain - AT4G24340",
        "content": "This gene, for instance, completes a cycle about every 9 hours. And it peaks at around 3 hours past dawn."
    },
    "step6": {
        "focus_object": "StepSeqMain - GPplot",
        "content": "We can confirm that this is the case by looking at the waveform here. \
        Notice the waveform cycles about every 9 hours, and peaks around 3.\
        We'll come back to this plot later."
    },
    "step3": {
        "focus_object": "StepSeqMain - y-axis - piano + AT4G24340",
        "content": "We can scale the detected oscillating frequency up to the audible range and map it to a keyboard. \
        This makes the relative pitches you hear between notes map to the relative difference in their oscillating speed."
    },
    "step3": {
        "focus_object": "StepSeqMain - AT4G24340",
        "content": "This gene peaks at around 3 hours after every 9 hour cycling, this means it should peaks around 12 hours and 21 hours as the \
        waveform loops again and again. You can click and drag the point to these equivalent phases."
    },
    "step3": {
        "focus_object": "StepSeqMain - GPplot",
        "content": "Focusing on the points here first. These are actual experimental data. We can see there is quite a bit of noise \
        and the points look quite clustered together. You can toggle between the full experimental period of 48 hours, or \
        wrap the data around the detected period to see how convincing the period is. Just looking at the points, how sure are we that this gene is really oscillating?"
    },
    "step3": {
        "focus_object": "StepSeqMain - q-value",
        "content": "The q-value tells us the probability that a random experimental data might be mistaken for oscillation. \
        A hard cutoff of 20% is set for this display and that is TREMENDOUSLY liberal. While this allows for more sounds to play with, \
        They might not all be real oscillations. You can use these violin plots to make your selection more stringent. Click and drag the \
        top and bottom to set a range, and click and drag the entire range itself to reposition it. A q-value of less than 5% is typical."
    },
    "step3": {
        "focus_object": "StepSeqMain - AT4G08930",
        "content": "Lets pick a gene closer to the beginning of the plot so we can hear it quicker. Have a listen if you want."
    },
    "step3": {
        "focus_object": "StepSeqMain - AT4G08930",
        "content": "If you have a keen ear, you might hear a slight wobble in the sound. That's because what you're hearing are 10 possible \
        waveforms that match the experimental data."
    },
    "step3": {
        "focus_object": "StepSeqMain - GPplot",
        "content": "As mentioned earlier, the points here are the experimental data. Compared to the previous gene, it looks more periodic \
        it has a much lower q-value! Notice there are 10 waveforms drawn for each gene. These 10 waveforms are pulled from all possible waveforms \
        that would satisfy the experimental data. The band shows the 95% confidence interval for the waveforms, and the blue line is the average."
    },
    "step3": {
        "focus_object": "StepSeqMain - AT4G08930",
        "content": "When you here a note, it morphs through the 10 sampled waveforms at a speed matching the confidence interval range. So the more \
        wobble you hear, the less certain we are of the waveform's shape."
    },
    "step3": {
        "focus_object": "StepSeqMain - relative std",
        "content": "You can also filter how wide the 95% confidence interval you find acceptable by using this violin plot."
    },
    "step3": {
        "focus_object": "StepSeqMain - gene list",
        "content": "This shows you the list of genes you have selected so far. And clicking on the gene shows you a focused view on the gene."
    },
    "step3": {
        "focus_object": "StepSeqMain - mainplot, focused on AT5G14740, show Unison",
        "content": "This band shows the 95% confidence interval for the focused gene's detected period. We're farely certain it falls within this band."
    },
    "step3": {
        "focus_object": "StepSeqMain - mainplot, focused on AT5G14740, show Perfect Fifth",
        "content": "These other bands show frequencies with small integer ratio relationship with the focused gene. For example, a frequency that is \
        a perfect fifth to our selected freqency would indicate for every 2 cycles the selected gene completes, the other gene would have completed 3. \
        If you click on a band, it locks the band in (click away to cancel), and shows you any gene whose detected period's 95% CI intersects with your focused gene. Deeper the color \
        the more they overlap."
    },
    "step3": {
        "focus_object": "StepSeqMain - mainplot, focused on AT5G14740, select AT4G17680",
        "content": "If you play them together, they should sound pleasant!"
    },
    "step3": {
        "focus_object": "None",
        "content": "You can zoom in and out, double click to reset view, and use the reset buttom to reset the gene selections. \
        This is mainly it! You can use this to explore sets of genes with mathmatical relationships with each other, or just try and \
        make some music. "
    }
}